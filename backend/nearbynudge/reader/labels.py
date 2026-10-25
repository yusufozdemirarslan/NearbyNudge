"""Human labels for pages ("About page") and ranking of homepage links for the Researcher."""

from __future__ import annotations

import re
from urllib.parse import unquote, urlsplit

from .types import Link, PageResult
from .urls import normalize_url

MAX_LABEL_CHARS = 40
MAX_LINK_TEXT_CHARS = 80

# kind -> label; the order is also the ranking order inside the high-value tier.
_KIND_LABELS = {
    "about": "About page",
    "services": "Services page",
    "contact": "Contact page",
    "team": "Team page",
    "booking": "Booking page",
    "pricing": "Pricing page",
    "insurance": "Insurance page",
    "new_patients": "New patients page",
    "faq": "FAQ page",
    "reviews": "Reviews page",
}
_KIND_ORDER = {kind: i for i, kind in enumerate(_KIND_LABELS)}

# Whole URL segments or title parts (lowercase, separators turned into spaces).
_KIND_PHRASES = {
    "contact": {
        "contact", "contact us", "contactus", "contacts", "get in touch", "reach us", "contact info",
        "contact information", "contact our office", "location", "locations", "directions", "visit us",
        "find us", "location and hours", "hours and location", "office hours", "hours",
    },
    "about": {
        "about", "about us", "aboutus", "our story", "who we are", "our practice", "our office", "our history",
        "meet us", "our company", "our mission", "why choose us", "why us", "our philosophy",
    },
    "team": {
        "team", "our team", "the team", "staff", "our staff", "doctors", "our doctors", "doctor", "providers",
        "our providers", "dentists", "our dentists", "our dentist", "physicians", "people", "leadership",
    },
    "booking": {
        "book", "booking", "book online", "book now", "appointment", "appointments", "request appointment",
        "request an appointment", "schedule", "schedule online", "schedule appointment", "schedule an appointment",
        "online booking", "online scheduling", "reservations", "reservation", "reserve", "make an appointment",
        "book an appointment", "book appointment",
    },
    "pricing": {
        "pricing", "prices", "price list", "fees", "our fees", "rates", "cost", "costs", "membership",
        "membership plan", "membership plans", "specials", "offers", "fee schedule", "plans and pricing",
    },
    "insurance": {
        "insurance", "financing", "payment options", "insurance financing", "insurance and financing",
        "payment", "payments", "billing", "insurance and payment", "insurance payment",
    },
    "new_patients": {
        "new patients", "new patient", "patient info", "patient information", "first visit", "your first visit",
        "patient forms", "forms", "new patient forms", "patient resources",
    },
    "faq": {"faq", "faqs", "frequently asked questions", "questions"},
    "reviews": {"reviews", "testimonials", "patient reviews", "what patients say", "testimonial", "patient testimonials"},
    "services": {
        "services", "our services", "service", "treatments", "procedures", "what we do", "menu", "our treatments",
        "services prices", "services and prices",
    },
}
# Single words that mark a kind anywhere in a multi-word segment ("dental-services", "meet-our-team").
_KIND_WORDS = (
    ("booking", {"booking", "appointment", "appointments", "scheduling", "reservations"}),
    ("pricing", {"pricing", "prices", "fees"}),
    ("insurance", {"insurance", "financing"}),
    ("faq", {"faq", "faqs"}),
    ("reviews", {"reviews", "testimonials"}),
    ("team", {"team", "staff", "doctors", "dentists", "providers", "physicians"}),
    ("services", {"services", "treatments", "procedures"}),
)

_HOME_SEGMENTS = {"index", "home", "default", "homepage", "home page", "welcome", "main"}
_BLOG_SEGMENTS = {"blog", "blogs", "news", "articles", "article", "posts", "post", "updates", "stories", "press", "journal"}
_FILE_SUFFIX_RE = re.compile(r"\.(?:html?|php\d?|aspx?|jsp|cfm|shtml)$", re.IGNORECASE)
_TITLE_SPLIT_RE = re.compile(r"\s+[|\-–—:·•»~]\s+|\s*[|·•»]\s*")
_SEPARATORS_RE = re.compile(r"[-_+.,:;!?&'\"()/–—]+")

# Pages never worth reading for prospecting: legal, accounts, carts, careers, feeds, archives.
_EXCLUDE_WORDS = {
    "privacy", "terms", "tos", "disclaimer", "cookie", "cookies", "accessibility", "login", "logon", "logout",
    "signin", "signup", "cart", "checkout", "basket", "wishlist", "careers", "career", "hiring", "sitemap",
    "unsubscribe", "gdpr", "ccpa", "hipaa", "portal", "dashboard", "trackback", "xmlrpc",
}
_EXCLUDE_SEGMENTS = {
    "legal", "account", "my account", "accounts", "register", "registration", "jobs", "employment", "feed", "rss",
    "atom", "tag", "tags", "category", "categories", "author", "authors", "search", "comments", "print", "share",
    "wp admin", "wp login", "wp json", "admin", "amp", "user", "users", "members", "member", "profile",
}
_EXCLUDE_PHRASES = (
    "log in", "sign in", "sign up", "my account", "join our team", "join the team", "work with us",
    "terms of use", "terms of service", "terms and conditions", "privacy policy", "cookie policy",
    "patient portal", "pay my bill", "pay bill", "bill pay", "pay online", "make a payment",
    "we are hiring", "were hiring", "notice of privacy practices", "site map",
)
_EXCLUDE_QUERY_KEYS = {"replytocom", "share", "print", "format", "feed", "s", "search", "q", "add-to-cart"}


def _segments(url: str) -> list[str]:
    try:
        path = urlsplit(url).path
    except ValueError:
        return []
    out = []
    for raw in unquote(path).split("/"):
        seg = _FILE_SUFFIX_RE.sub("", raw.strip()).lower()
        if seg:
            out.append(seg)
    return out


def _words(text: str) -> str:
    return " ".join(_SEPARATORS_RE.sub(" ", (text or "").lower()).split())


def _match_kind(phrase: str) -> tuple[str, bool] | None:
    """(kind, primary) for one URL segment or title part (already passed through _words).

    primary is False for word-only service matches ("fluoride-treatments"): those are usually
    one of many sub-pages, so they rank after the main About/Contact/Team/... pages.
    """
    if not phrase:
        return None
    for kind, phrases in _KIND_PHRASES.items():
        if phrase in phrases:
            return kind, True
    if phrase.startswith(("contact us", "contact our", "contact the")) or (
        phrase.startswith("contact ") and not phrase.startswith(("contact lens", "contact sport"))
    ):
        return "contact", True
    if phrase.startswith(("about us", "about our", "about the", "about dr", "about me")):
        return "about", True
    if phrase.startswith(("meet dr", "meet the", "meet our", "our doctor", "dr ")):
        return "team", True
    if "new patient" in phrase or "first visit" in phrase:
        return "new_patients", True
    if phrase.startswith(("book ", "schedule ", "request an appointment", "request appointment")):
        return "booking", True
    tokens = set(phrase.split())
    for kind, words in _KIND_WORDS:
        if tokens & words:
            return kind, kind != "services"
    return None


def _kind_of_phrase(phrase: str) -> str | None:
    match = _match_kind(phrase)
    return match[0] if match else None


def _is_home(segments: list[str]) -> bool:
    return not segments or (len(segments) == 1 and _words(segments[0]) in _HOME_SEGMENTS)


def _is_blog_post(segments: list[str]) -> bool:
    if len(segments) < 2:
        return False
    return _words(segments[0]) in _BLOG_SEGMENTS or re.fullmatch(r"(?:19|20)\d{2}", segments[0]) is not None


def _title_parts(title: str) -> list[str]:
    return [p.strip() for p in _TITLE_SPLIT_RE.split(" ".join((title or "").split())) if p.strip()]


def _shorten(name: str) -> str:
    name = " ".join(name.split())
    if name.lower().endswith(" page"):
        name = name[:-5].rstrip()
    if len(name) + 5 > MAX_LABEL_CHARS:
        cut = name[: MAX_LABEL_CHARS - 5]
        name = cut.rsplit(" ", 1)[0] if " " in cut else cut
        name = name.rstrip(" ,;:-&")
    return f"{name} page" if name else "Web page"


def page_label(url: str, title: str = "") -> str:
    """"Home page", "About page", "Contact page"... or a short title-based label such as "Smile Gallery page"."""
    segments = _segments(url)
    if _is_home(segments):
        try:
            query = urlsplit(url).query
        except ValueError:
            query = ""
        named = re.search(r"(?:^|&)(?:page|section|view)=([A-Za-z][\w-]*)", query)  # index.php?page=contact
        if named:
            segments = [named.group(1).lower()]
        elif re.search(r"(?:^|&)(?:page_id|p|post|id)=\d+", query):  # WordPress plain permalinks
            segments = []
        else:
            return "Home page"
    if _is_blog_post(segments):
        return "Blog post"
    kind = _kind_of_phrase(_words(segments[-1])) if segments else None
    if kind:
        return _KIND_LABELS[kind]
    parts = _title_parts(title)
    if parts:
        kind = _kind_of_phrase(_words(parts[0]))
        if kind:
            return _KIND_LABELS[kind]
    for seg in reversed(segments[:-1]):
        kind = _kind_of_phrase(_words(seg))
        if kind:
            return _KIND_LABELS[kind]
    if parts:
        return _shorten(parts[0])
    slug = _words(segments[-1]) if segments else ""
    if slug and not slug.replace(" ", "").isdigit():
        return _shorten(slug.title())
    return "Web page"


# ----------------------------------------------------------------- pick_links


def _excluded(url: str, text: str) -> bool:
    segments = _segments(url)
    for i, seg in enumerate(segments):
        phrase = _words(seg)
        if phrase in _EXCLUDE_SEGMENTS or set(phrase.split()) & _EXCLUDE_WORDS:
            return True
        if any(p in phrase for p in _EXCLUDE_PHRASES):
            return True
        if seg == "page" and i + 1 < len(segments) and segments[i + 1].isdigit():  # pagination
            return True
    try:
        query = urlsplit(url).query
    except ValueError:
        query = ""
    for pair in query.split("&"):
        key, _, value = pair.partition("=")
        key = key.lower()
        if key in _EXCLUDE_QUERY_KEYS or (key in ("page", "paged") and value.isdigit()):
            return True
        if key in ("page", "p", "section") and value and _excluded("/" + value, ""):
            return True
    words = _words(text)
    if words and (set(words.split()) & _EXCLUDE_WORDS or any(p in words for p in _EXCLUDE_PHRASES)):
        return True
    return False


def _link_rank(url: str, text: str) -> tuple[int, int]:
    """(score, order): 3 = high-value page, 2 = blog or news, 1 = anything else.

    Inside the high tier, main pages (About, Services, Contact, Team, Booking, Pricing, Insurance,
    New patients, FAQ, Reviews, in that order) come before service sub-pages.
    """
    segments = _segments(url)
    if _is_blog_post(segments):
        return 2, 0
    candidates = [_words(segments[-1])] if segments else []
    candidates.append(_words(text) if text else "")
    candidates.extend(_words(seg) for seg in reversed(segments[:-1]))
    best: tuple[int, int] | None = None
    for phrase in candidates:
        match = _match_kind(phrase)
        if match:
            kind, primary = match
            order = _KIND_ORDER[kind] + (0 if primary else len(_KIND_ORDER))
            if best is None or order < best[1]:
                best = (3, order)
            if primary:
                break
    if best:
        return best
    if any(_words(seg) in _BLOG_SEGMENTS for seg in segments):
        return 2, 0
    if text and set(_words(text).split()) & {"blog", "news"}:
        return 2, 0
    return 1, 0


def pick_links(home: PageResult, limit: int = 20) -> list[Link]:
    """Ranked same-site links from the homepage for the AI to choose from (high-value pages first)."""
    if home is None or not getattr(home, "links", None):
        return []
    def same_page_key(value: str) -> str:  # "/meet-dr-lee" and "/meet-dr-lee/" are one page
        parts = urlsplit(value)
        return f"{parts.scheme}://{parts.netloc}{parts.path.rstrip('/')}?{parts.query}"

    home_url = normalize_url(home.final_url or home.url)
    seen: set[str] = {same_page_key(home_url)}
    ranked: list[tuple[tuple, Link]] = []
    for position, link in enumerate(home.links):
        url = normalize_url(link.url)
        key = same_page_key(url)
        if key in seen:
            continue
        seen.add(key)
        if page_label(url) == "Home page":
            continue
        text = " ".join((link.text or "").split())
        if _excluded(url, text):
            continue
        score, order = _link_rank(url, text)
        depth = len(_segments(url))
        ranked.append(((-score, order, depth, position), Link(url=url, text=text[:MAX_LINK_TEXT_CHARS].rstrip())))
    ranked.sort(key=lambda item: item[0])
    return [link for _, link in ranked[: max(0, limit)]]
