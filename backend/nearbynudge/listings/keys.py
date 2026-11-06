"""Matching keys for listings: website domains, phone digits, distances.

Websites on shared platforms (Facebook pages, Linktree, Google Sites, Wix subdomains, ...) are
keyed by the page, not the platform, so two unrelated businesses with Linktree pages are never
merged as duplicates, and a do-not-contact entry for one never blocks the other.

The store computes these keys once per place when it loads listings; KEYS_VERSION changes
whenever the rules here change, so stored keys are recomputed.
"""

from __future__ import annotations

import math
import re

import idna

# 2: Facebook, YouTube and Instagram pages keyed past prefixes like /p/ and /channel/; international hosts in ASCII
KEYS_VERSION = "2"

EARTH_RADIUS_MI = 3958.7613
MILES_PER_DEGREE_LAT = EARTH_RADIUS_MI * math.pi / 180.0  # about 69.09
METERS_PER_MILE = 1609.344

# Public suffixes with two labels that matter for registrable domains outside .com/.org/.net.
_TWO_LABEL_SUFFIXES = frozenset(
    "co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk com.au net.au org.au co.nz org.nz com.mx "
    "com.br co.jp co.in com.cn com.tr co.za com.sg com.hk co.kr com.ar com.co com.pe com.ph "
    "com.pk com.ng co.il co.th com.my com.tw".split()
)
# Platforms where the business is the path: host or registrable domain -> path segments that
# name the business (0 = the URL cannot identify a business, so it is never used as a key).
_PATH_PLATFORMS = {
    "facebook.com": 1, "fb.com": 1, "fb.me": 1, "instagram.com": 1, "linktr.ee": 1,
    "linkin.bio": 1, "beacons.ai": 1, "bio.link": 1, "taplink.cc": 1, "campsite.bio": 1,
    "about.me": 1, "msha.ke": 1, "youtube.com": 1, "youtu.be": 1, "twitter.com": 1, "x.com": 1,
    "tiktok.com": 1, "pinterest.com": 1, "linkedin.com": 2, "nextdoor.com": 2, "yelp.com": 2,
    "tripadvisor.com": 1, "opentable.com": 1, "toasttab.com": 1, "doordash.com": 2,
    "grubhub.com": 2, "ubereats.com": 3, "seamless.com": 2, "vagaro.com": 1, "booksy.com": 3,
    "schedulicity.com": 2, "mindbodyonline.com": 2, "healthgrades.com": 2, "zocdoc.com": 2,
    "vitals.com": 2, "webmd.com": 2, "etsy.com": 2, "ebay.com": 2, "venmo.com": 1, "cash.app": 1,
    "gofundme.com": 2, "eventbrite.com": 2, "meetup.com": 1, "airbnb.com": 2, "vrbo.com": 1,
    "bit.ly": 1, "tinyurl.com": 1, "goo.gl": 2, "g.page": 1, "sites.google.com": 2,
    "google.com": 0, "maps.google.com": 0, "business.google.com": 0, "maps.app.goo.gl": 1,
    "wikipedia.org": 2, "homesnap.com": 2, "zillow.com": 2, "realtor.com": 2,
    "apartments.com": 1, "angi.com": 3, "homeadvisor.com": 3, "thumbtack.com": 3,
    "houzz.com": 2, "bbb.org": 4, "yellowpages.com": 2, "mapquest.com": 3, "foursquare.com": 3,
    "squareup.com": 2, "wix.com": 0, "amazon.com": 0, "paypal.com": 0, "calendly.com": 1,
    "setmore.com": 0, "godaddy.com": 0,
}
# First path segments that don't name the business on their own, and how many segments do there
# (0 = the URL can't identify a business): facebook.com/p/<name-id>, youtube.com/channel/<id>...
_FACEBOOK_PREFIXES = {
    "p": 2, "pg": 2, "people": 3, "pages": 3, "groups": 2, "events": 2, "watch": 0, "sharer": 0,
    "sharer.php": 0, "share": 0, "share.php": 0, "dialog": 0, "login": 0, "login.php": 0, "plugins": 0,
    "hashtag": 0, "search": 0, "home.php": 0, "story.php": 0, "permalink.php": 0, "photo.php": 0,
}
_PATH_PREFIXES = {
    "facebook.com": _FACEBOOK_PREFIXES,
    "fb.com": _FACEBOOK_PREFIXES,
    "youtube.com": {"channel": 2, "c": 2, "user": 2, "watch": 0, "embed": 0, "shorts": 0, "playlist": 0,
                    "results": 0, "feed": 0},
    "instagram.com": {"p": 2, "reel": 2, "reels": 2, "tv": 2, "stories": 2, "explore": 0, "accounts": 0},
}
# Platforms where each business gets its own subdomain: only the full host names a business.
_SUBDOMAIN_PLATFORMS = frozenset(
    "business.site wixsite.com godaddysites.com square.site weebly.com wordpress.com blogspot.com "
    "carrd.co myshopify.com webflow.io netlify.app github.io herokuapp.com vercel.app "
    "mystrikingly.com strikingly.com site123.me jimdosite.com jimdo.com ueniweb.com webnode.com "
    "yolasite.com simplesite.com squarespace.com wixstudio.io editorx.io hubspotpagebuilder.com "
    "zohosites.com tripod.com dudaone.com mydurable.com durable.co bandzoogle.com "
    "mailchimpsites.com myportfolio.com format.com smugmug.com".split()
)

_URL_RE = re.compile(
    r"^\s*(?:[a-z][a-z0-9+.\-]*://|//)?(?:[^@/?#\s]*@)?(\[[^\]/]*\]|[^:/?#\s]+)(?::\d*)?(/[^?#\s]*)?(?:\?([^#\s]*))?",
    re.IGNORECASE,
)
_WWW_RE = re.compile(r"^www\d*\.")


def _ascii_host(host: str) -> str:
    """'café.com' -> 'xn--caf-dma.com', as the reader and httpx write it; ASCII or invalid names as they are."""
    if host.isascii():
        return host
    try:
        return idna.encode(host).decode("ascii")
    except (idna.IDNAError, UnicodeError, ValueError):
        return host


def _parse(url: str | None) -> tuple[str | None, str, str]:
    """(lowercase host without 'www.', path, query) of a URL or bare host, or (None, '', '').
    International hosts are in their ASCII form."""
    m = _URL_RE.match(url or "")
    if not m:
        return None, "", ""
    host = _ascii_host(m.group(1).strip(".").lower())
    if host.startswith("www"):
        host = _WWW_RE.sub("", host)
    if not host or "." not in host and not host.startswith("["):
        return None, "", ""
    return host, m.group(2) or "", m.group(3) or ""


def _query_value(query: str, name: str) -> str:
    for part in query.split("&"):
        key, _, value = part.partition("=")
        if key.lower() == name:
            return value.strip()
    return ""


def host_of(url_or_host: str | None) -> str | None:
    """Lowercase host without 'www.', or None: 'https://WWW.Smile.com/x' -> 'smile.com'."""
    return _parse(url_or_host)[0]


def registrable_domain(host: str) -> str:
    """'arlington.smile.com' -> 'smile.com'; 'shop.example.co.uk' -> 'example.co.uk'."""
    labels = host.split(".")
    if len(labels) <= 2 or host.startswith("[") or host.replace(".", "").isdigit():
        return host
    if ".".join(labels[-2:]) in _TWO_LABEL_SUFFIXES:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _page_key(host: str, reg: str, path: str, query: str = "") -> str | None:
    """'linktr.ee/smiledental' for a page on a path platform; None if the URL names no page."""
    platform = host if host in _PATH_PLATFORMS else reg
    n = _PATH_PLATFORMS[platform]
    segments = [p.lower() for p in path.split("/") if p and p not in (".", "..")]
    if n and segments and platform in _PATH_PREFIXES:
        if platform in ("facebook.com", "fb.com") and segments[0] == "profile.php":
            page_id = _query_value(query, "id")  # facebook.com/profile.php?id=100063...: the id is the page
            return f"{platform}/profile.php?id={page_id}" if page_id.isdigit() else None
        n = _PATH_PREFIXES[platform].get(segments[0], n)
        if segments[:2] == ["pages", "category"]:
            n = 4  # facebook.com/pages/category/<category>/<name-id>
    if n == 0 or len(segments) < n:
        return None
    return f"{platform}/{'/'.join(segments[:n])}"


def _is_path_platform(host: str, reg: str) -> bool:
    return host in _PATH_PLATFORMS or reg in _PATH_PLATFORMS


def website_keys(url: str | None) -> frozenset[str]:
    """Forms of a website that a do-not-contact domain entry is compared with.

    An ordinary site gives its host and registrable domain ({'smile.com'}, or
    {'arlington.smile.com', 'smile.com'}); a page on a shared platform gives just the page
    ({'linktr.ee/smiledental'}, {'smile.business.site'}); a URL that names no business gives
    nothing ('https://google.com/maps').
    """
    host, path, query = _parse(url)
    if not host:
        return frozenset()
    reg = registrable_domain(host)
    if reg in _SUBDOMAIN_PLATFORMS:
        return frozenset({host}) if host != reg else frozenset()
    if _is_path_platform(host, reg):
        page = _page_key(host, reg, path, query)
        return frozenset({page}) if page else frozenset()
    return frozenset({host, reg})


def dedupe_key(url: str | None) -> str | None:
    """The key two listings of one business share: the site's host ('smile.com',
    'hubcapdave.bandzoogle.com'), or the page on a shared platform ('facebook.com/smiledental')."""
    host, path, query = _parse(url)
    if not host:
        return None
    reg = registrable_domain(host)
    if reg in _SUBDOMAIN_PLATFORMS:
        return host if host != reg else None
    if _is_path_platform(host, reg):
        return _page_key(host, reg, path, query)
    return host


def exclusion_keys(entry: str | None) -> frozenset[str]:
    """How a do-not-contact domain entry is compared: 'WWW.Smile.com' -> {'smile.com'};
    'linktr.ee/smiledental' -> {'linktr.ee/smiledental'}; a bare platform such as 'linktr.ee'
    stays {'linktr.ee'}, which matches no page on that platform."""
    host, path, _query = _parse(entry)
    if not host:
        return frozenset()
    if path.strip("/"):
        keys = website_keys(entry)
        if keys and all("/" in k for k in keys):
            return keys
    return frozenset({host})


def display_phone(phone: str | None) -> str | None:
    """A phone number the way people write it: "(703) 270-0466" for U.S. and Canadian numbers, others as listed."""
    raw = (phone or "").strip()
    if not raw:
        return None
    if re.search(r"[A-Za-z]", raw) or (raw.startswith("+") and not raw.startswith("+1")):
        return raw  # an extension, or a number outside North America
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return raw
    return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"


def phone_key(phone: str | None) -> str | None:
    """The last 10 digits of a phone number, or None when it has fewer than 10."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) < 10:
        return None
    last10 = digits[-10:]
    return None if len(set(last10)) == 1 else last10


def place_keys(websites, phones) -> tuple[list[str], list[str], list[str]]:
    """(dedupe keys, do-not-contact keys, phone keys) of one place, each sorted and unique."""
    sites: set[str] = set()
    webs: set[str] = set()
    for w in websites or ():
        k = dedupe_key(w)
        if k:
            sites.add(k)
        webs |= website_keys(w)
    tels = {k for p in phones or () if (k := phone_key(p))}
    return sorted(sites), sorted(webs), sorted(tels)


def haversine_mi(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(a)))


def bbox_around(lat: float, lon: float, radius_mi: float) -> tuple[float, float, float, float]:
    """(xmin, ymin, xmax, ymax) of the circle of `radius_mi` around a point."""
    dlat = radius_mi / MILES_PER_DEGREE_LAT
    dlon = radius_mi / (MILES_PER_DEGREE_LAT * max(math.cos(math.radians(lat)), 0.01))
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)
