"""Site check (RE3) and contact finder (RE5), both code only."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from nearbynudge.reader import (
    ContactResult,
    PageResult,
    Reader,
    SiteBudget,
    SiteCheckResult,
    find_contact,
    pick_links,
    site_check,
)
from nearbynudge.reader.contact import clean_email, decode_cf_email
from nearbynudge.reader.extract import analyze
from nearbynudge.reader.sitecheck import copyright_year
from tests.sites.fakeweb import long_text, page

UA = "NearbyNudgeBot/2.0 (+http://localhost:8000/bot)"
LISTING = "Business listing (Overture Maps, Oct 2026)"
SEEN = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)


async def read_site(base: str, max_links: int = 4) -> tuple[PageResult, list[PageResult]]:
    async with Reader(UA, allow_private=True, min_interval_s=0) as reader:
        budget = SiteBudget()
        home = await reader.fetch_home(base, budget)
        pages = [await reader.fetch(link.url, site=home.final_url, budget=budget) for link in pick_links(home)[:max_links]]
    return home, pages


def make_page(url: str, body: str, title: str = "Page", head: str = "", load_ms: int = 420) -> PageResult:
    """A PageResult as the reader would build it (no network)."""
    html = page(title, body, head)
    result = analyze(html, url)
    return PageResult(url=url, final_url=url, ok=True, status=200, error=None, fetched_at=SEEN, load_ms=load_ms,
                      title=result.title, html=html, text=result.text, links=result.links,
                      structured=result.structured, meta=result.meta)


# ------------------------------------------------------------------ site check on fixtures


async def test_site_check_studio(fixture_sites):
    home, pages = await read_site(fixture_sites["studio"])
    check = site_check(home, pages)
    assert check.url == fixture_sites["studio"] + "/"
    assert check.secure is False
    assert check.mobile_ready is False
    assert check.copyright_year == 2019
    assert check.online_booking is False
    assert check.hours is True
    assert check.prices is False
    assert check.social == ["Facebook"]
    assert isinstance(check.load_seconds, float)


async def test_site_check_family(fixture_sites):
    home, pages = await read_site(fixture_sites["family"])
    check = site_check(home, pages)
    assert check.mobile_ready is True
    assert check.online_booking is True
    assert check.hours is True
    assert check.prices is True
    assert check.social == ["Instagram"]
    assert check.copyright_year == datetime.now(timezone.utc).year


def test_site_check_without_a_home_page():
    check = site_check(None, [])
    assert check.url == "" and check.social == []
    assert (check.secure, check.mobile_ready, check.load_seconds, check.copyright_year) == (None, None, None, None)
    assert (check.online_booking, check.hours, check.prices) == (None, None, None)
    failed = PageResult(url="https://x.example/", final_url="https://x.example/", ok=False, error="timeout")
    assert site_check(failed, []).online_booking is None


def test_site_check_to_dict_is_json_safe():
    home = make_page("https://www.sample.example/", long_text(), head='<meta name="viewport" content="width=device-width">',
                     load_ms=1260)
    data = site_check(home, []).to_dict()
    json.dumps(data)
    assert data["checked_at"].endswith("Z") and "+" not in data["checked_at"]
    assert data["secure"] is True and data["mobile_ready"] is True and data["load_seconds"] == 1.3
    assert set(data) == {"url", "checked_at", "secure", "mobile_ready", "load_seconds", "copyright_year",
                         "online_booking", "hours", "prices", "social"}
    assert isinstance(site_check(home, []), SiteCheckResult)


@pytest.mark.parametrize(
    ("text", "year"),
    [
        ("© 2019 Sample Dental Studio", 2019),
        ("Copyright © 2009–2019 Sample", 2019),
        ("Copyright 2015 - 2024. All rights reserved.", 2024),
        ("© Sample Dental Studio, 2021", 2021),
        ("(c) 2018 Sample", 2018),
        ("© 2099 Sample", None),
        ("© 1990 Sample", None),
        ("Serving Arlington since 2009", None),
        ("© 2019 Sample · Since 2021 · 1200 N Example St, VA 22201", 2019),
        ("", None),
    ],
)
def test_copyright_year(text, year):
    assert copyright_year(text) == year


def test_copyright_entity_and_scripts():
    home = make_page("https://s.example/", long_text() + "<footer><span>&copy;</span> <span>2017</span> Sample</footer>"
                     "<script>/*! Copyright 2024 Some Library */</script>")
    assert site_check(home, []).copyright_year == 2017


@pytest.mark.parametrize(
    ("body", "booking"),
    [
        ('<a href="/book">Book Now</a>', True),
        ('<a class="btn" href="/appointments">Request an Appointment</a>', True),
        ('<button type="button">Schedule online</button>', True),
        ('<iframe src="https://www.zocdoc.com/widget/123"></iframe>', True),
        ('<script src="https://widget.nexhealth.com/appt.js"></script>', True),
        ('<a href="https://calendly.com/sample/visit">Pick a time</a>', True),
        ('<a href="tel:+17035550100">Call to book now</a>', False),
        ("<p>Call (703) 555-0100 to book.</p>", False),
        ('<a href="/services">Our services</a>', False),
    ],
)
def test_online_booking(body, booking):
    home = make_page("https://s.example/", long_text() + body)
    assert site_check(home, []).online_booking is booking


def test_booking_found_on_another_page():
    home = make_page("https://s.example/", long_text())
    contact = make_page("https://s.example/contact", long_text() + '<a href="https://www.localmed.com/x">Book online</a>')
    assert site_check(home, []).online_booking is False
    assert site_check(home, [contact]).online_booking is True


@pytest.mark.parametrize(
    ("body", "hours"),
    [
        ("<p>Mon–Fri 8am–5pm</p>", True),
        ("<p>Monday: 9:00 AM - 5:00 PM</p>", True),
        ("<h3>Office Hours</h3><p>8:30 a.m. to 4:30 p.m.</p>", True),
        ("<p>Saturdays 9am–1pm</p>", True),
        ("<p>Open 24/7 for emergencies</p>", True),
        ("<p>Call us during business hours.</p>", False),
        ("<p>We monitor every visit closely.</p>", False),
    ],
)
def test_hours_from_text(body, hours):
    assert site_check(make_page("https://s.example/", long_text() + body), []).hours is hours


def test_hours_and_prices_from_structured_data():
    ld = ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist",'
          '"openingHours":"Mo-Fr 08:00-17:00","priceRange":"$$"}</script>')
    check = site_check(make_page("https://s.example/", long_text(), head=ld), [])
    assert check.hours is True and check.prices is True
    offer = ('<script type="application/ld+json">{"@type":"Service","offers":{"@type":"Offer","price":"89"}}</script>')
    assert site_check(make_page("https://s.example/", long_text(), head=offer), []).prices is True


@pytest.mark.parametrize(
    ("body", "prices"),
    [
        ("<p>New patient exam from $89</p>", True),
        ("<p>Cleanings $ 129</p>", True),
        ("<p>Fillings starting at 150</p>", True),
        ("<p>We accept most insurance plans.</p>", False),
        ("<p>Starting at the front desk, our team will help.</p>", False),
    ],
)
def test_prices_from_text(body, prices):
    assert site_check(make_page("https://s.example/", long_text() + body), []).prices is prices


def test_social_links_in_order_without_share_buttons():
    body = long_text() + """
      <a href="https://www.youtube.com/@sample">YouTube</a> <a href="https://x.com/sample">X</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=https://s.example">Share</a>
      <a href="https://twitter.com/intent/tweet?url=x">Tweet</a> <a href="https://www.yelp.com/biz/sample">Yelp</a>
      <a href="https://www.linkedin.com/company/sample">LinkedIn</a> <a href="https://m.facebook.com/sample">FB</a>
      <a href="https://nextdoor.com/pages/sample">Nextdoor</a> <a href="https://www.tiktok.com/@sample">TikTok</a>
      <a href="https://www.pinterest.com/sample">Pins</a> <a href="https://instagram.com/sample">IG</a>"""
    social = site_check(make_page("https://s.example/", body), []).social
    assert social == ["Facebook", "Instagram", "LinkedIn", "X", "YouTube", "TikTok", "Yelp", "Nextdoor", "Pinterest"]
    only_share = make_page("https://s.example/", long_text() + '<a href="https://www.facebook.com/sharer.php?u=1">Share</a>')
    assert site_check(only_share, []).social == []


# ------------------------------------------------------------------ contact finder on fixtures


async def test_contact_studio(fixture_sites):
    home, pages = await read_site(fixture_sites["studio"])
    contact = find_contact(listing_emails=[], website=fixture_sites["studio"], pages=[home, *pages], listing_label=LISTING)
    contact_page = next(p for p in pages if p.final_url.endswith("/contact.html"))
    assert contact.kind == "email"
    assert contact.email == "office@samplestudio.example"
    assert contact.source_kind == "site"
    assert contact.source_label == "Contact page"
    assert contact.source_url == contact_page.final_url
    assert contact.seen_at == contact_page.fetched_at
    assert contact.form_url is None and contact.note is None


async def test_contact_family_has_only_a_form(fixture_sites):
    home, pages = await read_site(fixture_sites["family"])
    contact = find_contact(listing_emails=[], website=fixture_sites["family"], pages=[home, *pages], listing_label=LISTING)
    assert contact.kind == "form"
    assert contact.form_url == fixture_sites["family"] + "/contact/"
    assert contact.email is None and contact.source_kind == "site" and contact.source_label == "Contact page"


async def test_contact_nosolicit(fixture_sites):
    home, pages = await read_site(fixture_sites["nosolicit"])
    contact = find_contact(listing_emails=["hello@samplesmiles.example"], website=fixture_sites["nosolicit"],
                           pages=[home, *pages], listing_label=LISTING)
    assert contact.kind == "none"
    assert contact.email is None and contact.form_url is None and contact.source_kind is None
    assert contact.note == "Skipped a contact page that says no solicitations"


async def test_contact_cloudflare_only_address(fixture_sites):
    home, pages = await read_site(fixture_sites["injection"])
    contact = find_contact(listing_emails=[], website=fixture_sites["injection"], pages=[home, *pages], listing_label=LISTING)
    assert contact.kind == "email" and contact.email == "frontdesk@samplepediatric.example"


# ------------------------------------------------------------------ contact preference rules


def test_listing_only():
    contact = find_contact(listing_emails=["Info@SampleStudio.example"], website="https://samplestudio.example",
                           pages=[], listing_label=LISTING)
    assert contact.to_dict() == {
        "kind": "email", "email": "info@samplestudio.example", "form_url": None, "source_kind": "listing",
        "source_url": None, "source_label": LISTING, "seen_at": None, "note": None,
    }


def test_site_email_on_own_domain_beats_listing():
    contact_page = make_page("https://www.samplestudio.example/contact", long_text() + '<a href="mailto:office@samplestudio.example">Email</a>', "Contact")
    contact = find_contact(listing_emails=["sampledental@gmail.com"], website="http://samplestudio.example/",
                           pages=[contact_page], listing_label=LISTING)
    assert (contact.email, contact.source_kind, contact.source_label) == ("office@samplestudio.example", "site", "Contact page")
    assert contact.source_url == "https://www.samplestudio.example/contact" and contact.seen_at == SEEN


def test_listing_beats_site_email_on_another_domain():
    contact_page = make_page("https://www.samplestudio.example/contact", long_text() + "<p>Email sampledentalva@gmail.com</p>", "Contact")
    listing_other = find_contact(listing_emails=["frontdesk@yahoo.example"], website="https://www.samplestudio.example/",
                                 pages=[contact_page], listing_label=LISTING)
    assert listing_other.source_kind == "listing" and listing_other.email == "frontdesk@yahoo.example"
    listing_own = find_contact(listing_emails=["info@samplestudio.example"], website="https://www.samplestudio.example/",
                               pages=[contact_page], listing_label=LISTING)
    assert listing_own.source_kind == "listing" and listing_own.email == "info@samplestudio.example"
    site_only = find_contact(listing_emails=[], website="https://www.samplestudio.example/", pages=[contact_page],
                             listing_label=LISTING)
    assert site_only.email == "sampledentalva@gmail.com" and site_only.source_kind == "site"


def test_contact_page_then_home_then_others_and_role_addresses():
    home = make_page("https://s.example/", long_text() + "<p>Write to hello@s.example</p>", "Home")
    team = make_page("https://s.example/team", long_text() + "<p>jordan@s.example</p>", "Team")
    contact = make_page("https://s.example/contact", long_text() + "<p>Dr. Lee: jordan.lee@s.example or the office: info@s.example</p>", "Contact")
    found = find_contact(listing_emails=[], website="https://s.example", pages=[team, home, contact], listing_label=LISTING)
    assert (found.email, found.source_label) == ("info@s.example", "Contact page")
    found = find_contact(listing_emails=[], website="https://s.example", pages=[team, home], listing_label=LISTING)
    assert (found.email, found.source_label) == ("hello@s.example", "Home page")


def test_junk_addresses_are_dropped():
    body = long_text() + """<p>noreply@s.example example@s.example name@domain.com your@email.com
      logo@2x.png hero@3x.jpg 8f14e45fceea167a5a36dedd4bea2543@sentry.wixpress.com abc@o123.ingest.sentry.io
      wordpress@s.example privacy@s.example user@domain postmaster@s.example placeholder@godaddy.com</p>"""
    found = find_contact(listing_emails=["no-reply@s.example"], website="https://s.example",
                         pages=[make_page("https://s.example/", body)], listing_label=LISTING)
    assert found.kind == "none"


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("mailto:Office@SampleStudio.example?subject=Hi", "office@samplestudio.example"),
        ("office%40samplestudio.example", "office@samplestudio.example"),
        ("hello@samplesmiles.example.", "hello@samplesmiles.example"),
        ("team@example.com", "team@example.com"),
        ("owner@studio.ai", "owner@studio.ai"),
        ("office@sample.notatld", None),
        ("icon@2x.png", None),
        ("a..b@s.example", None),
        ("donotreply@s.example", None),
        ("", None),
    ],
)
def test_clean_email(raw, clean):
    assert clean_email(raw) == clean


def test_cloudflare_decoding():
    assert decode_cf_email("5a353c3c33393f1a293b372a363f292e2f3e3335743f223b372a363f") == "office@samplestudio.example"
    assert decode_cf_email("zz") is None and decode_cf_email("5a") is None


def test_email_from_structured_data():
    ld = '<script type="application/ld+json">{"@type":"Dentist","email":"mailto:care@s.example"}</script>'
    found = find_contact(listing_emails=[], website="https://s.example", pages=[make_page("https://s.example/", long_text(), head=ld)],
                         listing_label=LISTING)
    assert found.email == "care@s.example"


def test_page_forbidding_harvesting_is_skipped_but_listing_is_used():
    contact_page = make_page("https://s.example/contact", long_text() +
                             "<p>office@s.example</p><p>Addresses on this site may not be used for marketing.</p>", "Contact")
    found = find_contact(listing_emails=["info@s.example"], website="https://s.example", pages=[contact_page], listing_label=LISTING)
    assert found.source_kind == "listing" and found.email == "info@s.example"
    assert found.note == "Skipped a page that says its email addresses are not for marketing"
    alone = find_contact(listing_emails=[], website="https://s.example", pages=[contact_page], listing_label=LISTING)
    assert alone.kind == "none" and alone.note is not None


def test_no_solicitation_on_another_page_skips_only_that_page():
    home = make_page("https://s.example/", long_text() + "<p>Vendors: please do not drop in. hello@s.example</p>", "Home")
    team = make_page("https://s.example/team", long_text() + "<p>Reach Dr. Lee at jordan@s.example</p>", "Team")
    found = find_contact(listing_emails=[], website="https://s.example", pages=[home, team], listing_label=LISTING)
    assert found.email == "jordan@s.example"
    assert found.note == "Skipped a page that says no solicitations"


def test_skip_note_only_when_it_changed_the_outcome():
    footer = "<footer>office@s.example</footer>"
    contact = make_page("https://s.example/contact", long_text() + footer, "Contact")
    privacy = make_page("https://s.example/privacy", long_text() + footer + "<p>Do not harvest addresses.</p>", "Privacy")
    found = find_contact(listing_emails=[], website="https://s.example", pages=[privacy, contact], listing_label=LISTING)
    assert found.email == "office@s.example" and found.note is None


def test_contact_page_saying_no_solicitations_blocks_listing_email_too():
    contact = make_page("https://s.example/contact-us", long_text() + "<p>Solicitations are not accepted.</p>", "Contact Us")
    found = find_contact(listing_emails=["info@s.example"], website="https://s.example", pages=[contact], listing_label=LISTING)
    assert found.kind == "none" and found.note == "Skipped a contact page that says no solicitations"


@pytest.mark.parametrize(
    ("form", "is_contact"),
    [
        ('<form><input name="name"><input type="email" name="email"><textarea name="message"></textarea></form>', True),
        ('<form><input name="your-name"><input name="your-email"><input name="phone"></form>', True),
        ('<form role="search"><input type="search" name="s"></form>', False),
        ('<form action="/?s="><input name="s"><textarea></textarea></form>', False),
        ('<form class="newsletter"><input type="email" name="EMAIL"></form>', False),
        ('<form><input type="email" name="email"></form>', False),
        ('<form action="/login"><input name="user"><input type="password" name="pw"><textarea></textarea></form>', False),
        ('<form class="checkout"><input name="cc-number"><input type="email" name="email"><textarea></textarea></form>', False),
        ('<form id="commentform" action="/wp-comments-post.php"><textarea name="comment"></textarea></form>', False),
    ],
)
def test_contact_form_classification(form, is_contact):
    found = find_contact(listing_emails=[], website="https://s.example",
                         pages=[make_page("https://s.example/contact", long_text() + form, "Contact")], listing_label=LISTING)
    assert (found.kind == "form") is is_contact


def test_email_beats_form_and_nothing_found_is_none():
    with_form = make_page("https://s.example/contact", long_text() + '<form><textarea name="message"></textarea><input type="email"></form>', "Contact")
    home = make_page("https://s.example/", long_text() + "<p>info@s.example</p>")
    assert find_contact(listing_emails=[], website="https://s.example", pages=[home, with_form], listing_label=LISTING).kind == "email"
    empty = find_contact(listing_emails=[], website=None, pages=[], listing_label=LISTING)
    assert empty == ContactResult(kind="none")
    assert empty.to_dict()["seen_at"] is None
