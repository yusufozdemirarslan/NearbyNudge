"""The polite web reader.

Names itself, obeys robots.txt (cached per origin; unreadable means stay out), waits between
requests to a host, spends at most a business's page budget, refuses private addresses, follows
redirects by hand (checking every hop) and never runs JavaScript, submits forms or downloads
images, scripts or styles.
"""

from __future__ import annotations

import asyncio
import inspect
import ipaddress
import logging
import socket
import time
from dataclasses import dataclass
from datetime import datetime
from http.cookiejar import CookieJar, DefaultCookiePolicy
from typing import Callable
from urllib.parse import urljoin, urlsplit

import httpcore
import httpx
from protego import Protego

from .extract import Analysis, analyze, decode_body, looks_like_html
from .types import PageResult, SiteBudget, empty_meta, empty_structured, utcnow
from .urls import DEFAULT_PORTS, normalize_url, registrable_domain

log = logging.getLogger(__name__)

ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"
ACCEPT_LANGUAGE = "en-US,en;q=0.8"
ROBOTS_TOKEN = "NearbyNudgeBot"
ROBOTS_MAX_BYTES = 500_000
MAX_REDIRECTS = 5
MAX_CRAWL_DELAY_S = 10.0
BOT_CHECK_STATUSES = frozenset({403, 429, 503})
ERROR_BODY_MAX_BYTES = 262_144
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_HTML_TYPES = frozenset({"text/html", "application/xhtml+xml"})
_ALLOWED_PORTS = frozenset({80, 443})
_NAT64 = ipaddress.ip_network("64:ff9b::/96")


class BlockedAddressError(Exception):
    """The guarded transport refused to connect to a non-public address or port."""


async def resolve_host(host: str, port: int) -> list[str]:
    """Every IP address `host` resolves to, in resolver order (tests monkeypatch this)."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses: list[str] = []
    for _family, _type, _proto, _canonname, sockaddr in infos:
        address = str(sockaddr[0])
        if address not in addresses:
            addresses.append(address)
    return addresses


def is_blocked_ip(value: str) -> bool:
    """True for loopback, private, link-local, multicast, reserved, unspecified or other non-public IPs."""
    try:
        ip = ipaddress.ip_address(value.split("%", 1)[0].strip("[]"))
    except ValueError:
        return True
    candidates: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = [ip]
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped:
            candidates.append(ip.ipv4_mapped)
        if ip.sixtofour:
            candidates.append(ip.sixtofour)
        if ip.teredo:
            candidates.extend(ip.teredo)
        if ip in _NAT64:
            candidates.append(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
    return any(
        c.is_loopback or c.is_private or c.is_link_local or c.is_multicast or c.is_reserved or c.is_unspecified
        or not c.is_global
        for c in candidates
    )


class _GuardedBackend(httpcore.AsyncNetworkBackend):
    """Resolves and checks the address at connect time, then connects to that exact IP.

    This closes the gap between our pre-request check and the real connection (DNS rebinding).
    TLS still verifies the certificate against the hostname, because httpcore passes the
    original host as the server name.
    """

    def __init__(self) -> None:
        self._inner = httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if port not in _ALLOWED_PORTS:
            raise BlockedAddressError(f"port {port} is not allowed")
        try:
            ipaddress.ip_address(host)
            addresses = [host]
        except ValueError:
            try:
                addresses = await resolve_host(host, port)
            except OSError as exc:
                raise httpcore.ConnectError(str(exc)) from exc
        if not addresses or any(is_blocked_ip(a) for a in addresses):
            raise BlockedAddressError(f"{host} resolves to a non-public address")
        addresses.sort(key=lambda a: ":" in a)  # IPv4 first: broken IPv6 routes are common
        error: Exception = httpcore.ConnectError(f"could not connect to {host}")
        for address in addresses:
            try:
                return await self._inner.connect_tcp(
                    address, port, timeout=timeout, local_address=local_address, socket_options=socket_options
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                error = exc
        raise error

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise BlockedAddressError("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def _default_transport(allow_private: bool) -> httpx.AsyncBaseTransport:
    transport = httpx.AsyncHTTPTransport(retries=0)
    if allow_private:
        return transport
    try:
        transport._pool = httpcore.AsyncConnectionPool(  # noqa: SLF001 - swap in the guarded network backend
            ssl_context=httpx.create_ssl_context(),
            max_connections=100,
            max_keepalive_connections=20,
            keepalive_expiry=5.0,
            network_backend=_GuardedBackend(),
        )
    except Exception:  # pragma: no cover - only if httpx internals change
        log.warning("reader: connect-time address guard unavailable; relying on pre-request checks")
    return transport


@dataclass
class _Robots:
    state: str  # "rules" | "allow_all" | "unreadable"
    parser: Protego | None = None
    crawl_delay: float | None = None
    connect_failed: bool = False
    expires: float = 0.0

    def allows(self, url: str, token: str) -> bool:
        if self.state == "allow_all":
            return True
        if self.state != "rules" or self.parser is None:
            return False
        try:
            return bool(self.parser.can_fetch(url, token))
        except Exception:
            return False


@dataclass
class _Response:
    status: int | None = None
    content_type: str = ""
    body: bytes = b""
    location: str | None = None
    error: str | None = None
    connect_failed: bool = False
    too_large: bool = False
    load_ms: int = 0
    fetched_at: datetime | None = None


@dataclass
class _State:
    counted: bool = False  # this logical page fetch already took a budget slot
    connect_failed: bool = False  # last failure was a connection/TLS failure (https -> http fallback)


def _host_key(url: httpx.URL) -> str:
    host = url.host.lower()
    return host if url.port is None else f"{host}:{url.port}"


def _origin(url: httpx.URL) -> str:
    return f"{url.scheme}://{url.netloc.decode('ascii').lower()}"


async def _read_limited(response: httpx.Response, limit: int) -> tuple[bytes, bool]:
    """Read the (decoded) body up to `limit` bytes; True in the second slot if it was longer."""
    chunks: list[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > limit:
            return b"".join(chunks), True
        chunks.append(chunk)
    return b"".join(chunks), False


class Reader:
    """Reads businesses' own public websites, politely. Create one per process and share it."""

    def __init__(
        self,
        user_agent: str,
        *,
        allow_private: bool = False,
        min_interval_s: float = 1.0,
        timeout_s: float = 15.0,
        max_bytes: int = 2_000_000,
        robots_ttl_s: int = 86_400,
        is_opted_out: Callable[[str], bool] = lambda domain: False,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        if not user_agent or not user_agent.strip():
            raise ValueError("Reader needs a user agent that names the bot")
        self.user_agent = user_agent
        self.allow_private = bool(allow_private)
        self.min_interval_s = max(0.0, float(min_interval_s))
        self.timeout_s = float(timeout_s)
        self.max_bytes = int(max_bytes)
        self.robots_ttl_s = robots_ttl_s
        self._is_opted_out = is_opted_out
        product = user_agent.strip().split("/", 1)[0].split()
        self.robots_token = product[0] if product else ROBOTS_TOKEN
        self._client = httpx.AsyncClient(
            transport=transport if transport is not None else _default_transport(self.allow_private),
            headers={"User-Agent": user_agent, "Accept": ACCEPT, "Accept-Language": ACCEPT_LANGUAGE},
            timeout=httpx.Timeout(self.timeout_s),
            follow_redirects=False,
            cookies=CookieJar(policy=DefaultCookiePolicy(allowed_domains=[])),  # stateless: keep no cookies
            trust_env=False,
        )
        self._host_locks: dict[str, asyncio.Lock] = {}
        self._host_last: dict[str, float] = {}
        self._crawl_delay: dict[str, float] = {}
        self._robots: dict[str, _Robots] = {}
        self._robots_locks: dict[str, asyncio.Lock] = {}

    async def __aenter__(self) -> "Reader":
        return self

    async def __aexit__(self, *exc_info) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------ public API

    async def fetch_home(self, website: str, budget: SiteBudget) -> PageResult:
        """Fetch a business's homepage. Without a scheme, try https:// and fall back to http:// only
        when the connection or TLS handshake fails. Redirects may change the domain (rebrands);
        pass the result's `final_url` as `site` to later `fetch` calls."""
        raw = (website or "").strip()
        if raw.startswith("//"):
            raw = raw[2:]
        if not raw:
            return self._fail("", "", "network")
        attempts = [raw] if "://" in raw else ["https://" + raw, "http://" + raw]
        state = _State()
        result = await self._fetch(attempts[0], site=None, budget=budget, state=state)
        if len(attempts) > 1 and not result.ok and state.connect_failed:
            state.connect_failed = False
            result = await self._fetch(attempts[1], site=None, budget=budget, state=state)
        return result

    async def fetch(self, url: str, *, site: str, budget: SiteBudget) -> PageResult:
        """Fetch another page of the same site (`site` is the homepage's final URL)."""
        raw = (url or "").strip()
        base = (site or "").strip()
        if base and "://" not in base:
            base = "https://" + base.lstrip("/")
        if raw.startswith("//"):
            raw = (urlsplit(base).scheme or "https") + ":" + raw
        elif "://" not in raw and base:
            raw = urljoin(base, raw)
        site_domain = registrable_domain(base) if base else registrable_domain(raw)
        return await self._fetch(raw, site=site_domain, budget=budget, state=_State())

    # -------------------------------------------------------------- internals

    def _fail(self, url: str, final_url: str, error: str, *, status: int | None = None, title: str = "",
              load_ms: int = 0, fetched_at: datetime | None = None) -> PageResult:
        return PageResult(
            url=url, final_url=final_url or url, ok=False, status=status, error=error,
            fetched_at=fetched_at or utcnow(), load_ms=load_ms, title=title, html="", text="", links=[],
            structured=empty_structured(), meta=empty_meta(),
        )

    async def _opted_out(self, domain: str) -> bool:
        """Site-owner opt-out check; accepts a plain or an async callable. Fails closed."""
        try:
            answer = self._is_opted_out(domain)
            if inspect.isawaitable(answer):
                answer = await answer
            return bool(answer)
        except Exception:  # if we can't tell, don't read
            log.warning("reader: opt-out check failed for %s; skipping", domain, exc_info=True)
            return True

    async def _address_problem(self, target: httpx.URL) -> str | None:
        """None if we may connect; else "blocked_address" (private IP or odd port) or "network" (no DNS)."""
        if self.allow_private:
            return None
        port = target.port or DEFAULT_PORTS.get(target.scheme)
        if port not in _ALLOWED_PORTS:
            return "blocked_address"
        host = target.host
        try:
            ipaddress.ip_address(host)
            return "blocked_address" if is_blocked_ip(host) else None
        except ValueError:
            pass
        if host == "localhost" or host.endswith(".localhost"):
            return "blocked_address"
        try:
            addresses = await resolve_host(target.raw_host.decode("ascii"), port)
        except (OSError, ValueError):
            return "network"
        if not addresses or any(is_blocked_ip(a) for a in addresses):
            return "blocked_address"
        return None

    def _interval(self, key: str) -> float:
        return max(self.min_interval_s, self._crawl_delay.get(key, 0.0))

    async def _request(self, target: httpx.URL, *, kind: str, budget: SiteBudget | None = None,
                       state: _State | None = None) -> _Response:
        """One GET, at most one per interval per host (concurrent callers queue on the host's lock)."""
        key = _host_key(target)
        lock = self._host_locks.get(key)
        if lock is None:
            lock = self._host_locks[key] = asyncio.Lock()
        async with lock:
            if kind == "page" and budget is not None and state is not None and not state.counted:
                if budget.pages_used >= budget.max_pages:
                    return _Response(error="budget_exceeded")
                budget.pages_used += 1
                state.counted = True
            last = self._host_last.get(key)
            if last is not None:
                wait = last + self._interval(key) - time.monotonic()
                if wait > 0:
                    await asyncio.sleep(wait)
            started = time.monotonic()
            try:
                async with asyncio.timeout(self.timeout_s):
                    return await self._exchange(target, kind=kind, started=started)
            except BlockedAddressError:
                return _Response(error="blocked_address")
            except httpx.ConnectTimeout:
                return _Response(error="timeout", connect_failed=True)
            except httpx.ConnectError:
                return _Response(error="network", connect_failed=True)
            except (TimeoutError, httpx.TimeoutException):
                return _Response(error="timeout", load_ms=int((time.monotonic() - started) * 1000))
            except (httpx.HTTPError, httpx.InvalidURL, OSError, ValueError):
                log.debug("reader: request failed for %s", target, exc_info=True)
                return _Response(error="network")
            finally:
                self._host_last[key] = time.monotonic()

    async def _exchange(self, target: httpx.URL, *, kind: str, started: float) -> _Response:
        request = self._client.build_request("GET", target)
        response = await self._client.send(request, stream=True)
        try:
            status = response.status_code
            out = _Response(status=status, content_type=response.headers.get("content-type", ""))
            if status in _REDIRECT_STATUSES and response.headers.get("location"):
                out.location = response.headers["location"]
                return out
            if kind == "robots":
                if 200 <= status < 300:
                    out.body, out.too_large = await _read_limited(response, ROBOTS_MAX_BYTES)
                return out
            mime = out.content_type.split(";", 1)[0].strip().lower()
            if status >= 400:
                if status in BOT_CHECK_STATUSES and (not mime or mime in _HTML_TYPES):
                    out.body, _ = await _read_limited(response, min(self.max_bytes, ERROR_BODY_MAX_BYTES))
            elif 200 <= status < 300:
                if mime and mime not in _HTML_TYPES:
                    out.error = "not_html"
                    return out
                length = response.headers.get("content-length", "").strip()
                if length.isdigit() and int(length) > self.max_bytes:
                    out.error = "too_large"
                    return out
                out.body, too_large = await _read_limited(response, self.max_bytes)
                if too_large:
                    out.body, out.error = b"", "too_large"
                    return out
                if not mime and out.body and not looks_like_html(out.body):
                    out.body, out.error = b"", "not_html"
                    return out
            out.load_ms = int((time.monotonic() - started) * 1000)
            out.fetched_at = utcnow()
            return out
        finally:
            await response.aclose()

    async def _robots_for(self, target: httpx.URL) -> _Robots:
        origin = _origin(target)
        entry = self._robots.get(origin)
        if entry is not None and entry.expires > time.monotonic():
            return entry
        lock = self._robots_locks.get(origin)
        if lock is None:
            lock = self._robots_locks[origin] = asyncio.Lock()
        async with lock:
            entry = self._robots.get(origin)
            if entry is not None and entry.expires > time.monotonic():
                return entry
            entry = await self._load_robots(origin)
            entry.expires = time.monotonic() + self.robots_ttl_s
            self._robots[origin] = entry
            if entry.crawl_delay:
                key = _host_key(target)
                delay = min(float(entry.crawl_delay), MAX_CRAWL_DELAY_S)
                self._crawl_delay[key] = max(self._crawl_delay.get(key, 0.0), delay)
            return entry

    async def _load_robots(self, origin: str) -> _Robots:
        """2xx: obey; 404/410 and other 4xx: allowed; 401/403/429, 5xx, errors, > 500 KB: stay out."""
        url = origin + "/robots.txt"
        for _hop in range(MAX_REDIRECTS + 1):
            try:
                target = httpx.URL(url)
            except Exception:
                return _Robots("unreadable")
            if target.scheme not in ("http", "https") or not target.host:
                return _Robots("unreadable")
            if await self._address_problem(target):
                return _Robots("unreadable")
            response = await self._request(target, kind="robots")
            if response.error:
                return _Robots("unreadable", connect_failed=response.connect_failed)
            status = response.status or 0
            if status in _REDIRECT_STATUSES and response.location:
                url = urljoin(str(target), response.location.strip())
                continue
            if 200 <= status < 300:
                if response.too_large:
                    return _Robots("unreadable")
                try:
                    parser = Protego.parse(response.body.decode("utf-8-sig", "replace"))
                    delay = parser.crawl_delay(self.robots_token)
                except Exception:
                    return _Robots("unreadable")
                return _Robots("rules", parser=parser, crawl_delay=float(delay) if delay else None)
            if status in (401, 403, 429) or status >= 500:
                return _Robots("unreadable")
            if 400 <= status < 500:
                return _Robots("allow_all")
            return _Robots("unreadable")
        return _Robots("unreadable")  # too many redirects

    async def _fetch(self, url: str, *, site: str | None, budget: SiteBudget, state: _State) -> PageResult:
        requested = normalize_url(url)
        current = requested
        status: int | None = None
        for _hop in range(MAX_REDIRECTS + 1):
            try:
                target = httpx.URL(current)
            except Exception:
                return self._fail(requested, current, "network")
            if target.scheme not in ("http", "https") or not target.host:
                return self._fail(requested, current, "blocked_address")
            domain = registrable_domain(target.host)
            if await self._opted_out(domain):
                return self._fail(requested, current, "opted_out")
            if site is not None and domain != site:
                return self._fail(requested, current, "off_site")
            if not state.counted and budget.pages_used >= budget.max_pages:
                return self._fail(requested, current, "budget_exceeded")
            problem = await self._address_problem(target)
            if problem:
                return self._fail(requested, current, problem)
            robots = await self._robots_for(target)
            if robots.state == "unreadable":
                state.connect_failed = robots.connect_failed
                return self._fail(requested, current, "robots_unreadable")
            if not robots.allows(str(target), self.robots_token):
                return self._fail(requested, current, "robots_disallowed")
            response = await self._request(target, kind="page", budget=budget, state=state)
            status = response.status
            if response.error:
                state.connect_failed = response.connect_failed
                return self._fail(requested, current, response.error, status=status, load_ms=response.load_ms)
            if status in _REDIRECT_STATUSES and response.location:
                try:
                    current = normalize_url(urljoin(str(target), response.location.strip()))
                except ValueError:
                    return self._fail(requested, current, "http_error", status=status)
                continue
            return await self._page(requested, current, response)
        return self._fail(requested, current, "http_error", status=status)  # too many redirects

    async def _page(self, requested: str, final_url: str, response: _Response) -> PageResult:
        status = response.status
        html = decode_body(response.body, response.content_type) if response.body else ""
        analysis = await asyncio.to_thread(analyze, html, final_url, status) if html else Analysis()
        fetched_at = response.fetched_at or utcnow()
        common = dict(url=requested, final_url=final_url, status=status, fetched_at=fetched_at, load_ms=response.load_ms)
        if analysis.error == "bot_check":
            return self._fail(requested, final_url, "bot_check", status=status, title=analysis.title,
                              load_ms=response.load_ms, fetched_at=fetched_at)
        if status is None or not 200 <= status < 300:
            return self._fail(requested, final_url, "http_error", status=status, title=analysis.title,
                              load_ms=response.load_ms, fetched_at=fetched_at)
        if analysis.error == "login_page":
            return self._fail(requested, final_url, "login_page", status=status, title=analysis.title,
                              load_ms=response.load_ms, fetched_at=fetched_at)
        return PageResult(
            ok=True, error=None, title=analysis.title, html=html, text=analysis.text, links=analysis.links,
            structured=analysis.structured, meta=analysis.meta, **common,
        )
