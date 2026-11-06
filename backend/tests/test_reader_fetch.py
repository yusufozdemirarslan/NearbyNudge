"""Reader: politeness, safety and fetching (fixture sites plus an in-memory web)."""

from __future__ import annotations

import asyncio
import gzip
import time
import tracemalloc
import zlib

import httpcore
import httpx
import pytest

from nearbynudge.reader import READER_ERRORS, PageResult, Reader, SiteBudget
from nearbynudge.reader import fetcher
from tests.sites.fakeweb import FakeWeb, long_text, page

UA = "NearbyNudgeBot/2.0 (+http://localhost:8000/bot)"


def make_reader(web: FakeWeb | None = None, **kwargs) -> Reader:
    kwargs.setdefault("allow_private", True)
    kwargs.setdefault("min_interval_s", 0)
    return Reader(UA, transport=web.transport if web is not None else None, **kwargs)


@pytest.fixture
def web() -> FakeWeb:
    w = FakeWeb()
    w.robots("https://biz.test")
    w.html("https://biz.test/", "Biz Test | Home", long_text() + '<a href="/about">About</a>')
    w.html("https://biz.test/about", "About | Biz Test")
    return w


# ------------------------------------------------------------------ fixture sites


async def test_reads_fixture_home(fixture_sites):
    async with make_reader() as reader:
        budget = SiteBudget()
        home = await reader.fetch_home(fixture_sites["studio"], budget)
    assert home.ok and home.error is None and home.status == 200
    assert home.url == home.final_url == fixture_sites["studio"] + "/"
    assert home.title == "Sample Dental Studio | Family Dentist in Arlington, VA"
    assert "Call (703) 555-0100 to book" in home.text
    assert home.fetched_at.tzinfo is not None and home.fetched_at.utcoffset().total_seconds() == 0
    assert home.load_ms >= 0 and "<html" in home.html
    assert budget.pages_used == 1  # robots.txt is free


async def test_fixture_page_after_home(fixture_sites):
    base = fixture_sites["studio"]
    async with make_reader() as reader:
        budget = SiteBudget()
        home = await reader.fetch_home(base, budget)
        about = await reader.fetch(base + "/about.html", site=home.final_url, budget=budget)
    assert about.ok and "Dr. Jordan Lee has served Arlington families since 2009." in about.text
    assert budget.pages_used == 2


async def test_robots_disallow_for_our_bot(fixture_sites):
    async with make_reader() as reader:
        budget = SiteBudget()
        home = await reader.fetch_home(fixture_sites["blocked"], budget)
    assert not home.ok and home.error == "robots_disallowed"
    assert budget.pages_used == 0


async def test_fixture_bot_check(fixture_sites):
    async with make_reader() as reader:
        home = await reader.fetch_home(fixture_sites["botcheck"], SiteBudget())
    assert not home.ok and home.error == "bot_check" and home.status == 503
    assert home.text == "" and home.links == []


async def test_error_codes_are_listed():
    assert len(READER_ERRORS) == 13 and "budget_exceeded" in READER_ERRORS and "robots_unreadable" in READER_ERRORS


# ------------------------------------------------------------------ headers


async def test_sends_honest_headers(web):
    async with make_reader(web) as reader:
        await reader.fetch_home("https://biz.test/", SiteBudget())
    assert web.requests, "no requests sent"
    for request in web.requests:
        assert request.headers["User-Agent"] == UA
        assert request.headers["Accept"] == "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"
        assert request.headers["Accept-Language"] == "en-US,en;q=0.8"
        assert "cookie" not in request.headers


async def test_asks_only_for_compression_it_can_inflate(web, monkeypatch):
    # httpx advertises Brotli and zstd when their packages are installed, but the reader bounds only
    # gzip and deflate itself: a site answering in Brotli would read as "not a web page".
    import httpx._client

    monkeypatch.setattr(httpx._client, "ACCEPT_ENCODING", "gzip, deflate, br, zstd")
    async with make_reader(web) as reader:
        await reader.fetch_home("https://biz.test/", SiteBudget())
    assert web.requests, "no requests sent"
    for request in web.requests:
        assert request.headers["Accept-Encoding"] == "gzip, deflate"


# ------------------------------------------------------------------ robots.txt


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (200, "User-agent: *\nDisallow: /private\n", None),
        (200, "User-agent: NearbyNudgeBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n", "robots_disallowed"),
        (200, "User-agent: *\nDisallow: /\n", "robots_disallowed"),
        (404, "nope", None),
        (410, "gone", None),
        (400, "bad", None),
        (401, "auth", "robots_unreadable"),
        (403, "forbidden", "robots_unreadable"),
        (429, "slow down", "robots_unreadable"),
        (500, "oops", "robots_unreadable"),
        (503, "down", "robots_unreadable"),
    ],
)
async def test_robots_status_rules(status, body, expected):
    w = FakeWeb()
    w.robots("https://biz.test", body, status=status)
    w.html("https://biz.test/", "Home")
    async with make_reader(w) as reader:
        budget = SiteBudget()
        home = await reader.fetch_home("https://biz.test/", budget)
    assert home.error == expected
    assert home.ok is (expected is None)
    if expected is not None:
        assert w.page_requests() == [] and budget.pages_used == 0


async def test_robots_with_byte_order_mark_is_still_obeyed():
    w = FakeWeb()
    w.add("https://biz.test/robots.txt", 200, b"\xef\xbb\xbfUser-agent: *\nDisallow: /\n", content_type="text/plain")
    w.html("https://biz.test/", "Home")
    async with make_reader(w) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "robots_disallowed"


async def test_robots_path_rules_apply_per_page():
    w = FakeWeb()
    w.robots("https://biz.test", "User-agent: *\nDisallow: /private\n")
    w.html("https://biz.test/", "Home")
    w.html("https://biz.test/private/x", "Private")
    async with make_reader(w) as reader:
        budget = SiteBudget()
        home = await reader.fetch_home("https://biz.test/", budget)
        private = await reader.fetch("https://biz.test/private/x", site=home.final_url, budget=budget)
    assert home.ok and private.error == "robots_disallowed"
    assert "https://biz.test/private/x" not in w.requested()


@pytest.mark.parametrize("failure", ["timeout", "network", "too_large"])
async def test_robots_unreadable_means_stay_out(failure):
    w = FakeWeb()

    def robots(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        if failure == "network":
            raise httpx.RemoteProtocolError("broken", request=request)
        return httpx.Response(200, content=b"# " + b"x" * 600_000, headers={"Content-Type": "text/plain"})

    w.handle("https://biz.test/robots.txt", robots)
    w.html("https://biz.test/", "Home")
    w.html("https://biz.test/about", "About")
    async with make_reader(w) as reader:
        budget = SiteBudget()
        home = await reader.fetch_home("https://biz.test/", budget)
        about = await reader.fetch("https://biz.test/about", site="https://biz.test/", budget=budget)
    assert home.error == about.error == "robots_unreadable"
    assert w.page_requests() == []
    assert w.requested().count("https://biz.test/robots.txt") == 1  # cached: stay out until it expires


async def test_robots_cached_per_origin_and_refetched_after_ttl(web):
    async with make_reader(web) as reader:
        budget = SiteBudget(10)
        await reader.fetch_home("https://biz.test/", budget)
        await reader.fetch("https://biz.test/about", site="https://biz.test/", budget=budget)
        assert web.requested().count("https://biz.test/robots.txt") == 1
    async with make_reader(web, robots_ttl_s=0) as reader:
        budget = SiteBudget(10)
        await reader.fetch_home("https://biz.test/", budget)
        await reader.fetch("https://biz.test/about", site="https://biz.test/", budget=budget)
    assert web.requested().count("https://biz.test/robots.txt") == 3


async def test_robots_redirect_is_followed():
    w = FakeWeb()
    w.redirect("http://biz.test/robots.txt", "https://www.biz.test/robots.txt")
    w.robots("https://www.biz.test", "User-agent: *\nDisallow: /\n")
    w.html("http://biz.test/", "Home")
    async with make_reader(w) as reader:
        home = await reader.fetch_home("http://biz.test/", SiteBudget())
    assert home.error == "robots_disallowed"


async def test_crawl_delay_is_honored():
    w = FakeWeb()
    w.robots("https://biz.test", "User-agent: *\nCrawl-delay: 0.4\nAllow: /\n")
    w.html("https://biz.test/", "Home")
    w.html("https://biz.test/about", "About")
    async with make_reader(w, min_interval_s=0) as reader:
        budget = SiteBudget()
        await reader.fetch_home("https://biz.test/", budget)
        await reader.fetch("https://biz.test/about", site="https://biz.test/", budget=budget)
    times = {url: t for t, url in w.times}
    assert times["https://biz.test/about"] - times["https://biz.test/"] >= 0.38


async def test_crawl_delay_is_capped_and_never_lowers_the_interval():
    w = FakeWeb()
    w.robots("https://slow.test", "User-agent: *\nCrawl-delay: 60\n")
    w.html("https://slow.test/", "Home")
    w.robots("https://fast.test", "User-agent: *\nCrawl-delay: 0.1\n")
    w.html("https://fast.test/", "Home")
    async with make_reader(w, min_interval_s=1.0) as reader:
        await reader.fetch_home("https://slow.test/", SiteBudget())
        await reader.fetch_home("https://fast.test/", SiteBudget())
        assert reader._interval("slow.test") == 10.0
        assert reader._interval("fast.test") == 1.0


# ------------------------------------------------------------------ rate limits


async def test_one_request_per_interval_per_host():
    w = FakeWeb()
    w.robots("https://biz.test")
    for path in ("/", "/a", "/b"):
        w.html("https://biz.test" + path, "Page")
    async with make_reader(w, min_interval_s=0.3) as reader:
        budget = SiteBudget()
        started = time.monotonic()
        await asyncio.gather(
            reader.fetch("https://biz.test/a", site="https://biz.test/", budget=budget),
            reader.fetch("https://biz.test/b", site="https://biz.test/", budget=budget),
        )
        elapsed = time.monotonic() - started
    stamps = sorted(t for t, _ in w.times)
    assert len(stamps) == 3  # robots + 2 pages, robots fetched once
    assert all(b - a >= 0.28 for a, b in zip(stamps, stamps[1:], strict=False))
    assert elapsed >= 0.58


async def test_different_hosts_do_not_wait_for_each_other():
    w = FakeWeb()

    async def slow(request):
        await asyncio.sleep(0.3)
        return httpx.Response(200, text=page("Slow", long_text()), headers={"Content-Type": "text/html"})

    for host in ("one.test", "two.test"):
        w.robots(f"https://{host}")
        w.handle(f"https://{host}/", slow)
    async with make_reader(w, min_interval_s=1.0) as reader:
        started = time.monotonic()
        one, two = await asyncio.gather(
            reader.fetch_home("https://one.test/", SiteBudget()), reader.fetch_home("https://two.test/", SiteBudget())
        )
        elapsed = time.monotonic() - started
    assert one.ok and two.ok
    # Each host: robots, wait 1 s, page (0.3 s). In parallel that is ~1.3 s, not ~2.6 s.
    assert 1.0 <= elapsed < 2.2


# ------------------------------------------------------------------ budget


async def test_budget_is_enforced_without_a_request(web):
    web.html("https://biz.test/c", "C")
    async with make_reader(web) as reader:
        budget = SiteBudget(max_pages=2)
        home = await reader.fetch_home("https://biz.test/", budget)
        missing = await reader.fetch("https://biz.test/missing", site=home.final_url, budget=budget)
        third = await reader.fetch("https://biz.test/c", site=home.final_url, budget=budget)
    assert home.ok and missing.error == "http_error" and missing.status == 404
    assert third.error == "budget_exceeded" and not third.ok
    assert budget.pages_used == 2
    assert "https://biz.test/c" not in web.requested()


async def test_concurrent_fetches_never_overspend(web):
    for i in range(6):
        web.html(f"https://biz.test/p{i}", f"P{i}")
    async with make_reader(web) as reader:
        budget = SiteBudget(max_pages=3)
        results = await asyncio.gather(
            *(reader.fetch(f"https://biz.test/p{i}", site="https://biz.test/", budget=budget) for i in range(6))
        )
    assert sum(r.ok for r in results) == 3
    assert sum(r.error == "budget_exceeded" for r in results) == 3
    assert budget.pages_used == 3 and len(web.page_requests()) == 3


# ------------------------------------------------------------------ opt-outs


async def test_opted_out_site_is_never_contacted(web):
    async with make_reader(web, is_opted_out=lambda domain: domain == "biz.test") as reader:
        budget = SiteBudget()
        home = await reader.fetch_home("https://www.biz.test/", budget)
    assert home.error == "opted_out" and not home.ok
    assert web.requests == [] and budget.pages_used == 0


async def test_async_opt_out_checks_work(web):
    async def opted_out(domain):
        return domain == "biz.test"

    async with make_reader(web, is_opted_out=opted_out) as reader:
        blocked = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert blocked.error == "opted_out" and web.requests == []

    async def nobody(domain):
        return False

    async with make_reader(web, is_opted_out=nobody) as reader:
        assert (await reader.fetch_home("https://biz.test/", SiteBudget())).ok


async def test_opt_out_check_failure_fails_closed(web):
    def broken(domain):
        raise RuntimeError("db down")

    async with make_reader(web, is_opted_out=broken) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "opted_out" and web.requests == []


async def test_redirect_into_opted_out_domain_stops(web):
    web.redirect("https://biz.test/", "https://newname.test/")
    async with make_reader(web, is_opted_out=lambda d: d == "newname.test") as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "opted_out" and "https://newname.test/" not in web.requested()


# ------------------------------------------------------------------ SSRF


async def test_loopback_blocked_without_allow_private(fixture_sites):
    async with Reader(UA, min_interval_s=0) as reader:
        on_port = await reader.fetch_home(fixture_sites["studio"], SiteBudget())
        on_80 = await reader.fetch_home("http://127.0.0.1/", SiteBudget())
        localhost = await reader.fetch_home("http://localhost/", SiteBudget())
    assert on_port.error == on_80.error == localhost.error == "blocked_address"


async def test_hostname_resolving_to_private_ip_is_blocked(monkeypatch, web):
    async def fake_resolve(host, port):
        return ["10.0.0.5"]

    monkeypatch.setattr(fetcher, "resolve_host", fake_resolve)
    async with make_reader(web, allow_private=False) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "blocked_address" and web.requests == []


async def test_any_private_address_in_the_answer_blocks(monkeypatch, web):
    async def fake_resolve(host, port):
        return ["93.184.215.14", "::ffff:192.168.1.10"]

    monkeypatch.setattr(fetcher, "resolve_host", fake_resolve)
    async with make_reader(web, allow_private=False) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "blocked_address" and web.requests == []


async def test_redirect_to_private_ip_is_blocked(monkeypatch):
    async def fake_resolve(host, port):
        return {"biz.test": ["93.184.215.14"]}.get(host, ["127.0.0.1"])

    monkeypatch.setattr(fetcher, "resolve_host", fake_resolve)
    w = FakeWeb()
    w.robots("https://biz.test")
    w.redirect("https://biz.test/", "http://10.0.0.7/admin")
    w.html("http://10.0.0.7/admin", "Router admin")
    async with make_reader(w, allow_private=False) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "blocked_address"
    assert w.requested() == ["https://biz.test/robots.txt", "https://biz.test/"]


async def test_unusual_ports_and_schemes_refused(monkeypatch, web):
    async def fake_resolve(host, port):
        return ["93.184.215.14"]

    monkeypatch.setattr(fetcher, "resolve_host", fake_resolve)
    async with make_reader(web, allow_private=False) as reader:
        port = await reader.fetch_home("https://biz.test:8443/", SiteBudget())
        ftp = await reader.fetch_home("ftp://biz.test/file", SiteBudget())
    assert port.error == ftp.error == "blocked_address" and web.requests == []


async def test_unresolvable_host_is_a_network_error(monkeypatch, web):
    async def fake_resolve(host, port):
        raise OSError("Name or service not known")

    monkeypatch.setattr(fetcher, "resolve_host", fake_resolve)
    async with make_reader(web, allow_private=False) as reader:
        home = await reader.fetch_home("https://gone.test/", SiteBudget())
    assert home.error == "network"


@pytest.mark.parametrize(
    ("ip", "blocked"),
    [
        ("127.0.0.1", True), ("10.1.2.3", True), ("172.16.0.1", True), ("192.168.0.1", True),
        ("169.254.169.254", True), ("100.64.0.1", True), ("0.0.0.0", True), ("224.0.0.1", True),
        ("240.0.0.1", True), ("::1", True), ("fe80::1", True), ("fc00::1", True), ("::ffff:10.0.0.1", True),
        ("2002:0a00:0001::", True), ("64:ff9b::7f00:1", True), ("not-an-ip", True),
        ("93.184.215.14", False), ("8.8.8.8", False), ("2606:4700:4700::1111", False),
    ],
)
def test_is_blocked_ip(ip, blocked):
    assert fetcher.is_blocked_ip(ip) is blocked


async def test_connect_time_guard_blocks_dns_rebinding(monkeypatch):
    calls = []

    async def rebinding_resolve(host, port):
        calls.append(host)
        return ["127.0.0.1"]

    monkeypatch.setattr(fetcher, "resolve_host", rebinding_resolve)
    backend = fetcher._GuardedBackend()
    with pytest.raises(fetcher.BlockedAddressError):
        await backend.connect_tcp("biz.test", 443)
    with pytest.raises(fetcher.BlockedAddressError):
        await backend.connect_tcp("biz.test", 8080)
    with pytest.raises(fetcher.BlockedAddressError):
        await backend.connect_tcp("10.0.0.1", 80)
    assert calls == ["biz.test"]


def test_default_transport_uses_the_guard():
    transport = fetcher._default_transport(allow_private=False)
    assert isinstance(transport._pool, httpcore.AsyncConnectionPool)
    assert isinstance(transport._pool._network_backend, fetcher._GuardedBackend)


# ------------------------------------------------------------------ redirects and sites


async def test_off_site_redirect_refused(web):
    web.redirect("https://biz.test/about", "https://elsewhere.test/about")
    web.robots("https://elsewhere.test")
    web.html("https://elsewhere.test/about", "Elsewhere")
    async with make_reader(web) as reader:
        about = await reader.fetch("https://biz.test/about", site="https://biz.test/", budget=SiteBudget())
        direct = await reader.fetch("https://elsewhere.test/about", site="https://biz.test/", budget=SiteBudget())
    assert about.error == direct.error == "off_site"
    assert about.final_url == "https://elsewhere.test/about"
    assert not any(u.startswith("https://elsewhere.test") for u in web.requested())


async def test_subdomains_are_same_site(web):
    web.robots("https://shop.biz.test")
    web.html("https://shop.biz.test/", "Shop")
    async with make_reader(web) as reader:
        shop = await reader.fetch("https://shop.biz.test/", site="https://www.biz.test/", budget=SiteBudget())
    assert shop.ok


async def test_home_redirect_to_new_domain_is_followed(web):
    web.redirect("https://biz.test/", "https://www.newname.test/")
    web.robots("https://www.newname.test")
    web.html("https://www.newname.test/", "New Name")
    async with make_reader(web) as reader:
        budget = SiteBudget()
        home = await reader.fetch_home("https://biz.test/", budget)
    assert home.ok and home.url == "https://biz.test/" and home.final_url == "https://www.newname.test/"
    assert budget.pages_used == 1  # one page, however many hops


async def test_too_many_redirects():
    w = FakeWeb()
    w.robots("https://biz.test")
    for i in range(7):
        w.redirect(f"https://biz.test/r{i}", f"/r{i + 1}", status=302)
    async with make_reader(w) as reader:
        result = await reader.fetch("https://biz.test/r0", site="https://biz.test/", budget=SiteBudget())
    assert result.error == "http_error" and result.status == 302
    assert len(w.page_requests()) == 6  # the first request plus 5 redirects


async def test_scheme_less_website_tries_https_then_http():
    w = FakeWeb()

    def refuse(request):
        raise httpx.ConnectError("TLS handshake failed", request=request)

    w.handle("https://biz.test/robots.txt", refuse)
    w.handle("https://biz.test/", refuse)
    w.robots("http://biz.test")
    w.html("http://biz.test/", "Plain HTTP")
    async with make_reader(w) as reader:
        budget = SiteBudget()
        home = await reader.fetch_home("biz.test", budget)
    assert home.ok and home.final_url == "http://biz.test/" and home.url == "http://biz.test/"
    assert w.requested()[0] == "https://biz.test/robots.txt"
    assert budget.pages_used == 1


async def test_scheme_less_fixture_falls_back_after_a_real_tls_failure(fixture_sites):
    host_port = fixture_sites["studio"].removeprefix("http://")
    async with make_reader() as reader:
        started = time.monotonic()
        home = await reader.fetch_home(host_port, SiteBudget())
    assert home.ok and home.final_url == fixture_sites["studio"] + "/"
    assert time.monotonic() - started < 10


async def test_no_http_fallback_for_other_errors():
    w = FakeWeb()
    w.robots("https://biz.test")
    w.html("https://biz.test/", "Gone", status=404)
    w.robots("http://biz.test")
    w.html("http://biz.test/", "Plain HTTP")
    async with make_reader(w) as reader:
        home = await reader.fetch_home("biz.test", SiteBudget())
    assert home.error == "http_error" and home.status == 404
    assert not any(u.startswith("http://") for u in w.requested())


async def test_explicit_https_never_falls_back():
    w = FakeWeb()

    def refuse(request):
        raise httpx.ConnectError("refused", request=request)

    w.handle("https://biz.test/robots.txt", refuse)
    w.html("http://biz.test/", "Plain HTTP")
    async with make_reader(w) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "robots_unreadable"
    assert not any(u.startswith("http://") for u in w.requested())


# ------------------------------------------------------------------ content


async def test_not_html():
    w = FakeWeb()
    w.robots("https://biz.test")
    w.add("https://biz.test/menu", 200, b"%PDF-1.7 ...", content_type="application/pdf")
    w.add("https://biz.test/untyped-pdf", 200, b"%PDF-1.7 ...", content_type=None)
    w.add("https://biz.test/untyped-html", 200, page("Works", long_text()), content_type=None)
    async with make_reader(w) as reader:
        budget = SiteBudget(10)
        pdf = await reader.fetch("https://biz.test/menu", site="https://biz.test/", budget=budget)
        untyped = await reader.fetch("https://biz.test/untyped-pdf", site="https://biz.test/", budget=budget)
        sniffed = await reader.fetch("https://biz.test/untyped-html", site="https://biz.test/", budget=budget)
    assert pdf.error == untyped.error == "not_html"
    assert sniffed.ok and sniffed.title == "Works"


async def test_xhtml_is_accepted():
    w = FakeWeb()
    w.robots("https://biz.test")
    body = '<?xml version="1.0" encoding="utf-8"?>' + page("XHTML page", long_text())
    w.add("https://biz.test/", 200, body, content_type="application/xhtml+xml")
    async with make_reader(w) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.ok and home.title == "XHTML page"


async def test_too_large_by_header_and_by_stream():
    w = FakeWeb()
    w.robots("https://biz.test")
    w.add("https://biz.test/big", 200, page("Big", "<p>" + "x" * 5000 + "</p>"))

    async def chunks():
        for _ in range(10):
            yield b"<p>" + b"y" * 500 + b"</p>"

    w.handle("https://biz.test/stream", lambda r: httpx.Response(200, content=chunks(), headers={"Content-Type": "text/html"}))
    async with make_reader(w, max_bytes=1000) as reader:
        budget = SiteBudget(10)
        big = await reader.fetch("https://biz.test/big", site="https://biz.test/", budget=budget)
        streamed = await reader.fetch("https://biz.test/stream", site="https://biz.test/", budget=budget)
    assert big.error == streamed.error == "too_large"
    assert budget.pages_used == 2


async def test_http_errors_keep_status():
    w = FakeWeb()
    w.robots("https://biz.test")
    w.html("https://biz.test/oops", "Server error", status=500)
    w.html("https://biz.test/forbidden", "Forbidden", body="<p>You can't see this.</p>", status=403)
    async with make_reader(w) as reader:
        budget = SiteBudget(10)
        missing = await reader.fetch("https://biz.test/missing", site="https://biz.test/", budget=budget)
        oops = await reader.fetch("https://biz.test/oops", site="https://biz.test/", budget=budget)
        forbidden = await reader.fetch("https://biz.test/forbidden", site="https://biz.test/", budget=budget)
    assert (missing.error, missing.status) == ("http_error", 404)
    assert (oops.error, oops.status) == ("http_error", 500)
    assert (forbidden.error, forbidden.status) == ("http_error", 403)


async def test_timeouts():
    w = FakeWeb()
    w.robots("https://biz.test")

    def read_timeout(request):
        raise httpx.ReadTimeout("timed out", request=request)

    async def hang(request):
        await asyncio.sleep(5)
        return httpx.Response(200, text=page("Late", long_text()), headers={"Content-Type": "text/html"})

    w.handle("https://biz.test/slow", read_timeout)
    w.handle("https://biz.test/hang", hang)
    async with make_reader(w, timeout_s=0.3) as reader:
        budget = SiteBudget(10)
        slow = await reader.fetch("https://biz.test/slow", site="https://biz.test/", budget=budget)
        started = time.monotonic()
        hung = await reader.fetch("https://biz.test/hang", site="https://biz.test/", budget=budget)
        waited = time.monotonic() - started
    assert slow.error == hung.error == "timeout"
    assert waited < 2


async def test_network_error():
    w = FakeWeb()
    w.robots("https://biz.test")

    def reset(request):
        raise httpx.ReadError("connection reset", request=request)

    w.handle("https://biz.test/", reset)
    async with make_reader(w) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "network" and not home.ok


# ------------------------------------------------------------------ bot checks and logins

CF_CHALLENGE = (
    "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>"
    "<h2>Checking if the site connection is secure</h2>"
    "<script>window._cf_chl_opt={cType:'managed'};</script></body></html>"
)


async def test_bot_checks_detected():
    w = FakeWeb()
    w.robots("https://biz.test")
    w.add("https://biz.test/cf200", 200, CF_CHALLENGE)
    w.add("https://biz.test/cf403", 403, page("Attention Required! | Cloudflare", "<p>Sorry, you have been blocked</p>"))
    w.add("https://biz.test/captcha", 200, page("Verify", '<div class="g-recaptcha" data-sitekey="x"></div>'))
    w.add("https://biz.test/sg", 202, page("Robot Challenge Screen", '<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F">'))
    async with make_reader(w) as reader:
        budget = SiteBudget(10)
        results = [
            await reader.fetch(f"https://biz.test/{p}", site="https://biz.test/", budget=budget)
            for p in ("cf200", "cf403", "captcha", "sg")
        ]
    assert [r.error for r in results] == ["bot_check"] * 4
    assert all(r.text == "" and not r.ok for r in results)


async def test_normal_pages_with_cloudflare_scripts_or_captcha_forms_are_fine():
    w = FakeWeb()
    w.robots("https://biz.test")
    jsd = "<script>var s=document.createElement('script');s.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';</script>"
    w.html("https://biz.test/", "Home", long_text() + jsd)
    w.html(
        "https://biz.test/contact",
        "Contact",
        long_text() + '<form><textarea name="message"></textarea><div class="g-recaptcha"></div></form>'
        '<script src="https://www.google.com/recaptcha/api.js"></script>',
    )
    w.html("https://biz.test/security-check", "Security Check Services | Biz Test")
    async with make_reader(w) as reader:
        budget = SiteBudget(10)
        home = await reader.fetch_home("https://biz.test/", budget)
        contact = await reader.fetch("https://biz.test/contact", site="https://biz.test/", budget=budget)
        security = await reader.fetch("https://biz.test/security-check", site="https://biz.test/", budget=budget)
    assert home.ok and contact.ok and security.ok


async def test_login_walls_detected_but_header_logins_are_fine():
    w = FakeWeb()
    w.robots("https://biz.test")
    login_form = '<form action="/login" method="post"><input name="user"><input type="password" name="pw"><button>Log in</button></form>'
    w.html("https://biz.test/portal", "Sign in", "<h1>Patient portal</h1>" + login_form)
    w.html("https://biz.test/", "Home", login_form + long_text(300))
    async with make_reader(w) as reader:
        budget = SiteBudget(10)
        wall = await reader.fetch("https://biz.test/portal", site="https://biz.test/", budget=budget)
        home = await reader.fetch_home("https://biz.test/", budget)
    assert wall.error == "login_page" and not wall.ok and wall.text == ""
    assert home.ok


# ------------------------------------------------------------------ decoding


async def test_charset_from_header_meta_and_default():
    w = FakeWeb()
    w.robots("https://biz.test")
    text = "Café ’Best’ – open"
    w.add("https://biz.test/header", 200, page("Header", f"<p>{text}</p>" + long_text()).encode("cp1252"),
          content_type="text/html; charset=ISO-8859-1")
    meta_page = page("Meta", f"<p>{text}</p>" + long_text(), head='<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">')
    w.add("https://biz.test/meta", 200, meta_page.replace('<meta charset="utf-8">', "").encode("cp1252"), content_type="text/html")
    w.add("https://biz.test/default", 200, page("Default", f"<p>{text}</p>" + long_text()).replace('<meta charset="utf-8">', "").encode("utf-8"),
          content_type="text/html")
    w.add("https://biz.test/bad", 200, b"<html><head><title>Bad</title></head><body><p>ok \xff\xfe bytes</p>" + long_text().encode() + b"</body></html>",
          content_type="text/html; charset=utf-8")
    async with make_reader(w) as reader:
        budget = SiteBudget(10)
        results = {p: await reader.fetch(f"https://biz.test/{p}", site="https://biz.test/", budget=budget)
                   for p in ("header", "meta", "default", "bad")}
    for name in ("header", "meta", "default"):
        assert results[name].ok, name
        assert text in results[name].text, name
    assert results["bad"].ok and "�" in results["bad"].text


# ------------------------------------------------------------------ links


async def test_links_are_same_site_absolute_and_clean(fixture_sites):
    base = fixture_sites["studio"]
    async with make_reader() as reader:
        home = await reader.fetch_home(base, SiteBudget())
    urls = [link.url for link in home.links]
    assert urls == [base + "/", base + "/about.html", base + "/services.html", base + "/contact.html", base + "/privacy.html"]
    assert len(urls) == len(set(urls))
    assert not any("facebook" in u or u.endswith(".pdf") or "#" in u or u.startswith(("mailto:", "tel:")) for u in urls)
    assert dict((link.url, link.text) for link in home.links)[base + "/about.html"] == "About Us"


async def test_pagresult_defaults_are_safe():
    result = PageResult(url="https://biz.test/", final_url="https://biz.test/", ok=False, error="network")
    assert result.links == [] and result.structured == {"json-ld": [], "microdata": [], "opengraph": []}
    assert result.meta == {"viewport": None, "description": None, "generator": None, "lang": None}


async def test_reader_requires_a_user_agent():
    with pytest.raises(ValueError):
        Reader("  ")


async def test_international_domains_read_their_inner_pages():
    w = FakeWeb()
    w.robots("https://www.café.com")
    w.html("https://www.café.com/", "Café Home",
           long_text() + '<a href="/about">About us</a> <a href="https://www.xn--caf-dma.com/menu">Menu</a>')
    w.html("https://www.café.com/about", "About | Café")
    w.html("https://www.café.com/menu", "Menu | Café")
    async with make_reader(w) as reader:
        budget = SiteBudget()
        home = await reader.fetch_home("https://www.café.com/", budget)
        about = await reader.fetch("https://www.café.com/about", site=home.final_url, budget=budget)
        menu = await reader.fetch("https://www.xn--caf-dma.com/menu", site=home.final_url, budget=budget)
    assert home.ok
    assert [link.url for link in home.links] == ["https://www.café.com/about", "https://www.xn--caf-dma.com/menu"]
    assert about.ok and about.title == "About | Café"
    assert menu.ok and menu.title == "Menu | Café"


# ------------------------------------------------------------------ compressed replies


def _gzip_zeros(megabytes: int, *, wbits: int = 31) -> bytes:
    """An HTML-ish body of zeros, compressed: a few KB on the wire that inflate to `megabytes` MB."""
    c = zlib.compressobj(6, zlib.DEFLATED, wbits)
    block = b"\0" * 1_000_000
    parts = [c.compress(b"<html><body>")] + [c.compress(block) for _ in range(megabytes)]
    return b"".join(parts + [c.flush()])


async def _peak_mb(fetch) -> tuple[PageResult, float]:
    tracemalloc.start()
    try:
        result = await fetch()
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    return result, peak / 1_000_000


async def test_gzip_and_deflate_pages_are_read():
    w = FakeWeb()
    w.robots("https://biz.test")
    html = page("Packed", long_text()).encode("utf-8")
    raw_deflate = zlib.compressobj(6, zlib.DEFLATED, -zlib.MAX_WBITS)
    raw_deflate = raw_deflate.compress(html) + raw_deflate.flush()
    w.streamed("https://biz.test/gzip", gzip.compress(html), headers=[("Content-Encoding", "gzip")], chunk=100)
    w.streamed("https://biz.test/xgzip", gzip.compress(html), headers=[("Content-Encoding", "x-gzip")])
    w.streamed("https://biz.test/deflate", zlib.compress(html), headers=[("Content-Encoding", "deflate")])
    w.streamed("https://biz.test/raw-deflate", raw_deflate, headers=[("Content-Encoding", "deflate")])
    w.streamed("https://biz.test/identity", html, headers=[("Content-Encoding", "identity")], chunk=100)
    w.streamed("https://biz.test/plain", html)
    async with make_reader(w) as reader:
        budget = SiteBudget(10)
        results = {p: await reader.fetch(f"https://biz.test/{p}", site="https://biz.test/", budget=budget)
                   for p in ("gzip", "xgzip", "deflate", "raw-deflate", "identity", "plain")}
    for name, result in results.items():
        assert result.ok and result.title == "Packed", (name, result.error)
        assert "Our friendly team cares for families" in result.text, name


async def test_a_corrupt_gzip_body_is_a_network_error():
    w = FakeWeb()
    w.robots("https://biz.test")
    w.streamed("https://biz.test/", b"\x1f\x8b\x08\x00not really gzip", headers=[("Content-Encoding", "gzip")])
    async with make_reader(w) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "network"


async def test_a_compression_bomb_is_stopped_at_the_size_limit_without_inflating_it():
    w = FakeWeb()
    w.robots("https://biz.test")
    w.streamed("https://biz.test/", _gzip_zeros(60), headers=[("Content-Encoding", "gzip")])  # ~60 KB -> 60 MB
    async with make_reader(w) as reader:  # the default 2 MB limit
        home, peak = await _peak_mb(lambda: reader.fetch_home("https://biz.test/", SiteBudget()))
    assert home.error == "too_large"
    assert peak < 16, f"inflating the reply used {peak:.0f} MB"


async def test_a_body_just_under_the_limit_still_reads_when_compressed():
    w = FakeWeb()
    w.robots("https://biz.test")
    html = page("Fits", long_text()).encode("utf-8")
    w.streamed("https://biz.test/", gzip.compress(html), headers=[("Content-Encoding", "gzip")], chunk=7)
    async with make_reader(w, max_bytes=len(html)) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    async with make_reader(w, max_bytes=len(html) - 1) as reader:
        over = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.ok and home.title == "Fits"
    assert over.error == "too_large"


async def test_stacked_compression_is_refused_unread():
    w = FakeWeb()
    w.robots("https://biz.test")
    w.streamed("https://biz.test/", gzip.compress(_gzip_zeros(60)), headers=[("Content-Encoding", "gzip, gzip")])
    twice = gzip.compress(gzip.compress(page("Twice", long_text()).encode()))
    w.streamed("https://biz.test/split", twice, headers=[("Content-Encoding", "gzip"), ("Content-Encoding", "gzip")])
    async with make_reader(w) as reader:
        budget = SiteBudget(10)
        home, peak = await _peak_mb(lambda: reader.fetch_home("https://biz.test/", budget))
        split = await reader.fetch("https://biz.test/split", site="https://biz.test/", budget=budget)
    assert home.error == split.error == "too_large"
    assert peak < 16, f"inflating the reply used {peak:.0f} MB"


async def test_an_encoding_we_cant_decode_is_not_read_as_html():
    w = FakeWeb()
    w.robots("https://biz.test")
    w.streamed("https://biz.test/", b"\x8b\x01\x80hello\x03", headers=[("Content-Encoding", "br")])
    async with make_reader(w) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "not_html"


async def test_robots_compressed_twice_means_stay_out():
    w = FakeWeb()
    w.streamed("https://biz.test/robots.txt", gzip.compress(gzip.compress(b"User-agent: *\nAllow: /\n")),
               content_type="text/plain", headers=[("Content-Encoding", "gzip, gzip")])
    w.html("https://biz.test/", "Home")
    async with make_reader(w) as reader:
        home = await reader.fetch_home("https://biz.test/", SiteBudget())
    assert home.error == "robots_unreadable"
    assert w.page_requests() == []
