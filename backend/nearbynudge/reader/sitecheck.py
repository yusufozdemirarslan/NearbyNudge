"""Site check (RE3), computed by code from the pages the reader fetched."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import urlsplit

from .extract import anchor_text, document_text, iter_hrefs, parse_document
from .types import PageResult, iso_z, utcnow
from .urls import registrable_domain

FIRST_PLAUSIBLE_YEAR = 1995


@dataclass
class SiteCheckResult:
    url: str
    checked_at: datetime
    secure: bool | None = None
    mobile_ready: bool | None = None
    load_seconds: float | None = None
    copyright_year: int | None = None
    online_booking: bool | None = None
    hours: bool | None = None
    prices: bool | None = None
    social: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "checked_at": iso_z(self.checked_at),
            "secure": self.secure,
            "mobile_ready": self.mobile_ready,
            "load_seconds": self.load_seconds,
            "copyright_year": self.copyright_year,
            "online_booking": self.online_booking,
            "hours": self.hours,
            "prices": self.prices,
            "social": list(self.social),
        }


@dataclass
class _Doc:
    page: PageResult
    root: object
    text: str  # visible text of the HTML plus the reader's text
    html_lower: str


def page_docs(pages: list[PageResult | None]) -> list[_Doc]:
    """Parsed, deduplicated ok pages (shared with the contact finder)."""
    docs: list[_Doc] = []
    seen: set[str] = set()
    for page in pages:
        if page is None or not page.ok:
            continue
        key = page.final_url or page.url
        if key in seen:
            continue
        seen.add(key)
        root = parse_document(page.html or "")
        visible = document_text(root)
        text = visible if (page.text or "") in visible else f"{visible}\n{page.text}"
        docs.append(_Doc(page=page, root=root, text=text, html_lower=(page.html or "").lower()))
    return docs


# ------------------------------------------------------------- copyright year

_COPYRIGHT_RE = re.compile(
    r"(?:©|&copy;|&#169;|&#xa9;|\(c\)|\bcopyright\b)[^0-9\n]{0,60}?((?:19|20)\d{2})"
    r"(?:\s*[-–—]\s*((?:19|20)\d{2}))?",
    re.IGNORECASE,
)


def copyright_year(text: str) -> int | None:
    """Largest plausible year (1995..this year) next to ©, &copy; or "Copyright"."""
    current = utcnow().year
    best: int | None = None
    for match in _COPYRIGHT_RE.finditer(text or ""):
        for group in match.groups():
            if group and FIRST_PLAUSIBLE_YEAR <= int(group) <= current and (best is None or int(group) > best):
                best = int(group)
    return best


# ------------------------------------------------------------ online booking

_BOOKING_PROVIDERS_RE = re.compile(
    r"zocdoc\.com|localmed\.com|nexhealth\.com|modento\.io|flexbook\.me|opencare\.com|solutionreach\.com"
    r"|lh360\.com|lighthouse360\.com|lighthouse-360\.com|getweave\.com|yapiapp\.com|yapicentral\.com|yapi\.me"
    r"|calendly\.com|acuityscheduling\.com|[a-z0-9-]+\.as\.me\b|squareup\.com/appointments|book\.squareup\.com"
    r"|square\.site/book|setmore\.com|simplybook\.(?:me|it|net)|vagaro\.com|mindbodyonline\.com|mindbody\.io"
    r"|booksy\.com|schedulicity\.com|fresha\.com|housecallpro\.com|getjobber\.com|servicetitan\.com"
    r"|opentable\.com|resy\.com|exploretock\.com|youcanbook\.me|appointy\.com|demandforce\.com",
    re.IGNORECASE,
)
_BOOKING_TEXT_RE = re.compile(
    r"\b(?:book(?:ing)?\s+(?:online|now|today|an?\s+appointment|appointment|an?\s+visit|your\s+(?:appointment|visit)"
    r"|a\s+(?:consultation|table|session|service))"
    r"|schedule\s+(?:online|now|today|an?\s+appointment|appointment|an?\s+visit|your\s+(?:appointment|visit)"
    r"|a\s+(?:consultation|service))"
    r"|request\s+(?:an?\s+)?appointment|online\s+(?:scheduling|booking)|reserve\s+(?:online|now|a\s+table))\b",
    re.IGNORECASE,
)


def _has_booking(doc: _Doc) -> bool:
    if _BOOKING_PROVIDERS_RE.search(doc.html_lower):
        return True
    if doc.root is None:
        return False
    for el in doc.root.iter("a", "button", "input"):
        if el.tag == "a":
            if (el.get("href") or "").strip().lower().startswith(("tel:", "mailto:", "sms:")):
                continue
            label = anchor_text(el)
        elif el.tag == "input":
            if (el.get("type") or "").lower() not in ("submit", "button"):
                continue
            label = el.get("value") or ""
        else:
            label = " ".join(el.text_content().split()) or el.get("aria-label") or ""
        if _BOOKING_TEXT_RE.search(label):
            return True
    return False


# ------------------------------------------------------------- hours, prices

_DAY = r"(?:mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?s?\.?"
_CLOCK = r"(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2}|noon|midnight)"
_RANGE = rf"{_CLOCK}\s*(?:-|–|—|to|until|till)\s*{_CLOCK}"
_HOURS_RE = re.compile(
    rf"\b{_DAY}(?![a-z])[^\n]{{0,40}}?{_RANGE}"
    rf"|\bhours\b[\s\S]{{0,120}}?{_RANGE}"
    r"|\bopen\s+24\s*(?:hours|/\s*7)\b|\b24\s*/\s*7\b|\b24\s+hours\s+a\s+day\b",
    re.IGNORECASE,
)
_PRICE_RE = re.compile(
    r"\$\s?\d|\b(?:starting|starts)\s+(?:at|from)\s+\$?\s?\d|\bfrom\s+\$\s?\d|\b\d+(?:\.\d{2})?\s?(?:usd|dollars)\b",
    re.IGNORECASE,
)


def _walk(obj):
    """Yield (key, value) for every key of every dict nested in obj."""
    stack = [obj]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            for key, value in item.items():
                yield str(key), value
                stack.append(value)
        elif isinstance(item, list):
            stack.extend(item)


def _short_key(key: str) -> str:
    return key.rsplit("/", 1)[-1].rsplit("#", 1)[-1]


def _structured_has_hours(structured: dict) -> bool:
    for key, value in _walk(structured or {}):
        if _short_key(key) in ("openingHours", "openingHoursSpecification", "hoursAvailable") and value:
            return True
    return False


def _structured_has_prices(structured: dict) -> bool:
    for key, value in _walk(structured or {}):
        short = _short_key(key)
        if short == "priceRange" and value:
            return True
        if short in ("price", "lowPrice", "highPrice") and value not in (None, "", [], {}):
            return True
    return False


# ------------------------------------------------------------------- social

_SOCIAL_NETWORKS = (
    ("Facebook", {"facebook.com", "fb.com", "fb.me"}),
    ("Instagram", {"instagram.com", "instagr.am"}),
    ("LinkedIn", {"linkedin.com", "lnkd.in"}),
    ("X", {"twitter.com", "x.com"}),
    ("YouTube", {"youtube.com", "youtu.be"}),
    ("TikTok", {"tiktok.com"}),
    ("Yelp", {"yelp.com", "yelp.to"}),
    ("Nextdoor", {"nextdoor.com"}),
    ("Pinterest", {"pinterest.com", "pin.it"}),
)
_SHARE_PATH_RE = re.compile(
    r"^/(?:sharer|share|dialog|plugins|intent|sharearticle|sharing|pin/create|tr(?:/|$)|home\.php)", re.IGNORECASE
)


def _social(docs: list[_Doc]) -> list[str]:
    found: set[str] = set()
    for doc in docs:
        for url, _a in iter_hrefs(doc.root, doc.page.final_url or doc.page.url):
            parts = urlsplit(url)
            if _SHARE_PATH_RE.match(parts.path or "/"):
                continue
            domain = registrable_domain(parts.hostname or "")
            for name, domains in _SOCIAL_NETWORKS:
                if domain in domains:
                    found.add(name)
    return [name for name, _ in _SOCIAL_NETWORKS if name in found]


# --------------------------------------------------------------- site check


def site_check(home: PageResult | None, pages: list[PageResult]) -> SiteCheckResult:
    """Secure connection, mobile-ready layout, load time, copyright year, online booking, hours,
    prices and social links. All None (social empty) when there is no readable homepage."""
    checked_at = utcnow()
    if home is None or not home.ok:
        url = (home.final_url or home.url) if home is not None else ""
        return SiteCheckResult(url=url, checked_at=checked_at)
    docs = page_docs([home, *(pages or [])])
    home_doc = docs[0]
    viewport = (home.meta or {}).get("viewport") or ""
    if not viewport and home_doc.root is not None:
        for el in home_doc.root.iter("meta"):
            if (el.get("name") or "").strip().lower() == "viewport":
                viewport = el.get("content") or ""
                break
    return SiteCheckResult(
        url=home.final_url or home.url,
        checked_at=checked_at,
        secure=urlsplit(home.final_url or home.url).scheme.lower() == "https",
        mobile_ready=bool(re.search(r"width\s*=\s*device-width", viewport, re.IGNORECASE)),
        load_seconds=round(max(0, home.load_ms or 0) / 1000, 1),
        copyright_year=copyright_year(home_doc.text),
        online_booking=any(_has_booking(doc) for doc in docs),
        hours=any(_structured_has_hours(doc.page.structured) or _HOURS_RE.search(doc.text) for doc in docs),
        prices=any(_structured_has_prices(doc.page.structured) or _PRICE_RE.search(doc.text) for doc in docs),
        social=_social(docs),
    )
