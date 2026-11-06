"""Text and URL helpers: masking, quote checks, text fragments, domains and URL normalization."""

from __future__ import annotations

import pytest

from nearbynudge.reader import mask_contacts, normalize_url, quote_in_text, registrable_domain, text_fragment_url

# ------------------------------------------------------------------ mask_contacts


@pytest.mark.parametrize(
    ("text", "masked"),
    [
        ("Call (703) 555-0100 to book", "Call [phone] to book"),
        ("Phone 703.555.0100.", "Phone [phone]."),
        ("Call +1 703 555 0100 today", "Call [phone] today"),
        ("Toll free 1-800-555-0199 ext. 12", "Toll free [phone]"),
        ("Text 7035550100", "Text [phone]"),
        ("Tel:703-555-0100", "Tel:[phone]"),
        ("Email office@x.example or call (703) 555-0100", "Email [email] or call [phone]"),
        ("Write to Office.Manager+web@sample-studio.example.", "Write to [email]."),
    ],
)
def test_mask_contacts_masks_emails_and_phones(text, masked):
    assert mask_contacts(text) == masked


@pytest.mark.parametrize(
    "text",
    [
        "Serving Arlington families since 2009",
        "New patient exam from $89, cleanings $129",
        "1200 N Example St, Arlington, VA 22201",
        "ZIP 22201-1234",
        "Open Mon–Fri 8am–5pm, Sat 9:00–13:00",
        "© 2009–2019 Sample Dental Studio",
        "Payment plans for treatment over $1,500",
        "Order #2024-1015 shipped 10/24/2026",
        "Suite 300, 2800 Wilson Blvd",
    ],
)
def test_mask_contacts_leaves_other_numbers_alone(text):
    assert mask_contacts(text) == text


def test_mask_contacts_handles_empty_text():
    assert mask_contacts("") == "" and mask_contacts(None) == ""


# ------------------------------------------------------------------ quote_in_text

PAGE = (
    "About Sample Dental Studio\n"
    "Dr. Jordan Lee has served Arlington families since 2009. After dental school, Dr. Lee opened the studio.\n"
    "We're not accepting new patients on Saturdays.\n"
    "Call (703) 555-0100 to book, or email office@samplestudio.example.\n"
    "Hours: Mon–Fri 8am–5pm"
)


@pytest.mark.parametrize(
    "quote",
    [
        "Dr. Jordan Lee has served Arlington families since 2009.",
        "dr. jordan lee HAS SERVED arlington families",
        "“Dr. Jordan Lee has served Arlington families since 2009”",
        "We’re not accepting new patients on Saturdays",
        "Dr.  Jordan\n  Lee has   served Arlington families",
        "Hours: Mon-Fri 8am-5pm",
        "Hours: Mon – Fri 8am – 5pm",
        "Dr Jordan Lee has served Arlington families since 2009",
        "Dr. Jordan Lee has served Arlington familes since 2009",
        "Call [phone] to book, or email [email].",
        "Call [phone] to book",
        "...has served Arlington families since 2009...",
    ],
)
def test_quote_in_text_accepts_real_quotes(quote):
    assert quote_in_text(quote, PAGE)


@pytest.mark.parametrize(
    "quote",
    [
        "Dr. Jordan Lee has served Arlington families since 2010.",
        "We're accepting new patients on Saturdays",
        "Sample Dental Studio offers free whitening for every new patient",
        "Call [phone] to cancel",
        "",
        "   ...  ",
    ],
)
def test_quote_in_text_rejects_other_text(quote):
    assert not quote_in_text(quote, PAGE)


def test_quote_in_text_with_empty_page():
    assert not quote_in_text("anything", "")


def test_quote_in_text_long_page_is_fast():
    import time

    text = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. " * 3000) + PAGE
    started = time.monotonic()
    assert quote_in_text("Dr. Jordan Lee has served Arlington familes since 2009", text)
    assert not quote_in_text("an entirely different sentence about crowns and veneers today", text)
    assert time.monotonic() - started < 2.0


# ------------------------------------------------------------------ text_fragment_url


def test_text_fragment_short_quote():
    url = text_fragment_url("https://x.example/about#team", "Mon-Fri, 8am & 5pm")
    assert url == "https://x.example/about#:~:text=Mon%2DFri%2C%208am%20%26%205pm"


def test_text_fragment_long_quote_uses_start_and_end():
    url = text_fragment_url("https://x.example/about", "Dr. Jordan Lee has served Arlington families since 2009 with care.")
    assert url == "https://x.example/about#:~:text=Dr.%20Jordan%20Lee%20has,since%202009%20with%20care."


def test_text_fragment_eight_words_stay_whole():
    url = text_fragment_url("https://x.example/", "one two three four five six seven eight")
    assert url.endswith("#:~:text=one%20two%20three%20four%20five%20six%20seven%20eight")


def test_text_fragment_spans_masked_contacts():
    url = text_fragment_url("https://x.example/contact", "Call [phone] to book")
    assert url == "https://x.example/contact#:~:text=Call,to%20book"
    assert text_fragment_url("https://x.example/contact", "[email]") == "https://x.example/contact"


def test_text_fragment_collapses_whitespace():
    assert text_fragment_url("https://x.example/", "  Free\n parking  ") == "https://x.example/#:~:text=Free%20parking"


# ------------------------------------------------------------------ registrable_domain


@pytest.mark.parametrize(
    ("value", "domain"),
    [
        ("https://www.samplestudio.example/x", "samplestudio.example"),
        ("samplestudio.example", "samplestudio.example"),
        ("http://WWW.SampleStudio.Example:8080/path?q=1", "samplestudio.example"),
        ("https://shop.sample.co.uk/", "sample.co.uk"),
        ("https://www.bbc.co.uk", "bbc.co.uk"),
        ("https://dentist.com.au/about", "dentist.com.au"),
        ("https://www.ballstondentalcare.com/", "ballstondentalcare.com"),
        ("http://127.0.0.1:8701/about.html", "127.0.0.1"),
        ("http://[::1]:8000/", "::1"),
        ("localhost:8000", "localhost"),
        ("http://localhost/", "localhost"),
        ("", ""),
        ("https://www.café.com/", "xn--caf-dma.com"),  # international names compare as httpx connects: punycode
        ("https://www.xn--caf-dma.com/menu", "xn--caf-dma.com"),
        ("https://WWW.CAFÉ.com", "xn--caf-dma.com"),
        ("https://www.diş-kliniği.com.tr/", "xn--di-klinii-xkb11e.com.tr"),
    ],
)
def test_registrable_domain(value, domain):
    assert registrable_domain(value) == domain


def test_host_names_that_arent_valid_international_names_are_kept_as_they_are():
    from nearbynudge.reader.urls import host_of

    assert host_of("https://😀.example/") == "😀.example"
    assert host_of("https://www.Café.com:8080/x") == "www.xn--caf-dma.com"


# ------------------------------------------------------------------ normalize_url


@pytest.mark.parametrize(
    ("url", "normalized"),
    [
        ("HTTP://WWW.Example.COM:80/Path?utm_source=x&a=1#frag", "http://www.example.com/Path?a=1"),
        ("https://example.com:443", "https://example.com/"),
        ("https://example.com:8443/a", "https://example.com:8443/a"),
        ("https://example.com/a?fbclid=1&gclid=2&b=2&UTM_medium=y", "https://example.com/a?b=2"),
        ("https://example.com/a?q=hello%20world&x=", "https://example.com/a?q=hello%20world&x="),
        ("https://user:pw@example.com/a", "https://example.com/a"),
        ("https://example.com/a/#top", "https://example.com/a/"),
    ],
)
def test_normalize_url(url, normalized):
    assert normalize_url(url) == normalized
    assert normalize_url(normalized) == normalized
