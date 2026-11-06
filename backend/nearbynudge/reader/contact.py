"""Contact finder (RE5): code only, never guesses.

Picks an email published by the business (its site, or the listing) or else a contact form, with
its source. Skips pages that say they don't want solicitations or that forbid using their
addresses for marketing.
"""

from __future__ import annotations

import functools
import ipaddress
import re
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import unquote

from .labels import page_label
from .sitecheck import _walk, page_docs
from .textutil import EMAIL_RE
from .types import PageResult, iso_z
from .urls import registrable_domain

NOTE_NO_SOLICITATIONS = "Skipped a contact page that says no solicitations"
NOTE_NO_SOLICITATIONS_OTHER = "Skipped a page that says no solicitations"
NOTE_NO_HARVESTING = "Skipped a page that says its email addresses are not for marketing"

ROLE_LOCAL_PARTS = frozenset(
    {
        "info", "office", "contact", "hello", "frontdesk", "front.desk", "front-desk", "appointments",
        "appointment", "team", "admin", "reception", "mail", "inquiries", "enquiries", "hi", "help", "support",
        "service", "sales", "booking", "bookings", "scheduling", "schedule", "care", "smile", "smiles", "general",
        "contactus", "contact-us", "office.manager", "officemanager", "manager", "staff", "dental", "clinic",
    }
)

_JUNK_LOCALS = frozenset(
    {
        "example", "name", "email", "e-mail", "user", "username", "yourname", "your.name", "your_name", "your",
        "you", "youremail", "your.email", "your-email", "someone", "somebody", "test", "testing", "firstname",
        "lastname", "firstname.lastname", "first.last", "first", "john.doe", "jane.doe", "johndoe", "janedoe",
        "john.smith", "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "do_not_reply",
        "dontreply", "postmaster", "abuse", "privacy", "wordpress", "mailer-daemon", "hostmaster", "dmca",
        "unsubscribe", "bounce", "bounces", "nobody", "null", "root", "spam", "sentry",
    }
)
_JUNK_LOCAL_PREFIXES = ("noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "bounce", "mailer-daemon")
_JUNK_DOMAINS = frozenset(
    {
        "domain.com", "domain.net", "domain.org", "yourdomain.com", "yourcompany.com", "company.com",
        "mysite.com", "yoursite.com", "website.com", "yourwebsite.com", "sentry.io", "godaddy.com",
        "test.com", "email.tld", "example.example",
    }
)
_EMAIL_FULL_RE = re.compile(
    r"[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}"
)
_CF_HREF_RE = re.compile(r"/cdn-cgi/l/email-protection#([0-9a-fA-F]+)")

_NO_SOLICIT_RE = re.compile(
    r"\bno\s+solicit(?:ation|ations|ing|ors)?\b"
    r"|\bsolicitations?\s+(?:are|is)\s+not\s+(?:accepted|welcome|permitted|allowed|wanted)"
    r"|\bnot\s+for\s+solicitations?\b|\bdo\s+not\s+solicit\b|\bno\s+sales\s+(?:calls|inquiries|pitches|emails)\b"
    r"|\bvendors\s*[:,-]?\s*please\s+do\s+not\b|\bwe\s+do\s+not\s+accept\s+solicitations?\b"
    r"|\bsolicitors?\s+(?:are\s+)?not\s+welcome\b|\bplease\s+do\s+not\s+solicit\b",
    re.IGNORECASE,
)
_NO_HARVEST_RE = re.compile(
    r"not\s+to\s+be\s+used\s+for\s+unsolicited|do\s+not\s+harvest|may\s+not\s+be\s+used\s+for\s+(?:marketing|commercial|unsolicited)"
    r"|(?:must|shall|should)\s+not\s+be\s+used\s+for\s+(?:marketing|unsolicited)|harvesting\s+of\s+(?:e-?mail\s+)?addresses"
    r"|unsolicited\s+commercial\s+e-?mail\s+(?:is|are)\s+(?:prohibited|not\s+permitted)",
    re.IGNORECASE,
)
# "No sales or marketing inquiries", "No vendor or sales calls, please".
_SALES_KIND = r"(?:sales|marketing|vendor|advertising|seo|telemarketing)"
_NO_SALES_RE = re.compile(
    rf"\bno\s+{_SALES_KIND}(?:\s*(?:,(?:\s*(?:or|and)\b)?|/|or\b|and\b)\s*{_SALES_KIND})*\s+"
    r"(?:calls|inquiries|enquiries|pitches|e-?mails|messages|requests|offers|visits|reps|representatives)\b",
    re.IGNORECASE,
)
# Other wordings are caught a sentence at a time: a word like "solicit" or "unsolicited" close to a refusal
# ("We do not accept unsolicited sales calls", "Solicitations of any kind are not welcome", "Unsolicited
# emails will be ignored"), unless the sentence only disclaims ("This site is not a solicitation") or makes a
# promise of the business's own ("We will never solicit your password", "We do not send unsolicited email").
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?;])\s+|\n+")
_REFUSAL_WORDS = frozenset(
    {
        "no", "not", "never", "nor", "cannot", "prohibited", "forbidden", "unwelcome", "ignored", "deleted",
        "discarded", "disregarded", "declined", "refuse", "refused", "refrain",
    }
)
_REFUSAL_REACH = 5  # words between the refusal and the solicitation word
_NOT_A_REFUSAL_RE = re.compile(
    r"\bnot\s+(?:(?:intended|meant)\s+(?:as|to\s+be)\s+|(?:to\s+)?be\s+(?:construed|considered|taken)\s+as\s+"
    r"|considered\s+)?an?\s+(?:offer|solicitation)\b"
    r"|\bconstitut\w*\s+(?:an?\s+)?(?:offer|solicitation)|\bnor\s+(?:an?\s+)?solicitation"
    r"|\b(?:will|would|shall)\s+(?:never|not)\s+(?:ask\s+for|request|solicit|send|share|sell|rent)\b"
    r"|\b(?:won't|wouldn't)\s+(?:ever\s+)?(?:ask\s+for|request|solicit|send|share|sell|rent)\b"
    r"|\b(?:we|i)\s+(?:never|don't|do\s+not)\s+(?:send|share|sell|rent|solicit)\b",
    re.IGNORECASE,
)


def _refuses_solicitations(sentence: str) -> bool:
    last_ask = last_refusal = None
    for i, word in enumerate(re.findall(r"[a-z']+", sentence.lower())):
        if word.startswith(("solicit", "unsolicit")):
            if last_refusal is not None and i - last_refusal <= _REFUSAL_REACH:
                return True
            last_ask = i
        if word in _REFUSAL_WORDS or word.endswith("n't"):
            if last_ask is not None and i - last_ask <= _REFUSAL_REACH:
                return True
            last_refusal = i
    return False


def says_no_solicitations(text: str) -> bool:
    """True when the page asks not to be sold to: "No solicitations", "We do not accept unsolicited
    sales calls or emails", "No sales or marketing inquiries"... A notice that only forbids using the
    page's addresses for marketing is a harvest notice (_NO_HARVEST_RE), not a refusal."""
    text = (text or "").replace("\N{RIGHT SINGLE QUOTATION MARK}", "'")  # don’t -> don't
    if _NO_SOLICIT_RE.search(text) or _NO_SALES_RE.search(text):
        return True
    for sentence in _SENTENCE_SPLIT_RE.split(text):
        if "solicit" not in sentence.lower() or _NO_HARVEST_RE.search(sentence) or _NOT_A_REFUSAL_RE.search(sentence):
            continue
        if _refuses_solicitations(sentence):
            return True
    return False


@dataclass
class ContactResult:
    kind: str  # "email" | "form" | "none"
    email: str | None = None
    form_url: str | None = None
    source_kind: str | None = None  # "site" | "listing" | None
    source_url: str | None = None
    source_label: str | None = None
    seen_at: datetime | None = None
    note: str | None = None

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "email": self.email,
            "form_url": self.form_url,
            "source_kind": self.source_kind,
            "source_url": self.source_url,
            "source_label": self.source_label,
            "seen_at": iso_z(self.seen_at),
            "note": self.note,
        }


# ------------------------------------------------------------------ emails


_FILE_LIKE_TLDS = frozenset(
    {
        "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tif", "tiff", "heic", "avif", "css", "js",
        "json", "pdf", "zip", "mov", "mp4", "mp3", "wav", "txt", "xml", "html", "htm", "php", "asp", "aspx",
        "woff", "woff2", "ttf", "eot", "map",
    }
)


@functools.lru_cache(maxsize=2048)
def _is_known_tld(label: str) -> bool:
    if label == "example":  # RFC 2606 names used by our fixtures and tests
        return True
    if label in _FILE_LIKE_TLDS:
        return False  # "logo@2x.png", "hero@2x.jpg"...
    try:
        from tld import get_tld

        return get_tld(f"http://a.{label}", fail_silently=True, fix_protocol=False) is not None
    except Exception:  # pragma: no cover - without `tld`, accept any alphabetic TLD
        return label.isalpha()


def decode_cf_email(hex_value: str) -> str | None:
    """Decode Cloudflare's email protection (first byte is the XOR key)."""
    try:
        data = bytes.fromhex(hex_value)
    except ValueError:
        return None
    if len(data) < 2:
        return None
    key = data[0]
    try:
        return bytes(b ^ key for b in data[1:]).decode("utf-8")
    except UnicodeDecodeError:
        return None


def clean_email(raw: str | None) -> str | None:
    """Lowercased, validated contact address, or None for junk, placeholders and lookalikes."""
    if not raw:
        return None
    value = unquote(str(raw)).strip()
    if value.lower().startswith("mailto:"):
        value = value[7:]
    value = value.split("?", 1)[0].strip().strip(".,;:()<>[]{}\"'").lower()
    if not _EMAIL_FULL_RE.fullmatch(value):
        return None
    local, domain = value.rsplit("@", 1)
    if ".." in value or local.startswith(".") or local.endswith("."):
        return None
    tld = domain.rsplit(".", 1)[-1]
    if not _is_known_tld(tld):
        return None
    if re.match(r"^\d+(?:\.\d+)?x\.", domain):  # retina image names: icon@2x.png
        return None
    if local in _JUNK_LOCALS or local.startswith(_JUNK_LOCAL_PREFIXES):
        return None
    if domain in _JUNK_DOMAINS or domain.endswith((".godaddy.com", ".sentry.io", "wixpress.com")):
        return None
    if re.fullmatch(r"[0-9a-f]{16,}", local):  # tracking keys, not people
        return None
    return value


def _page_emails(doc) -> list[str]:
    """Emails a page publishes: mailto links, Cloudflare-protected addresses, visible text, schema.org."""
    found: list[str] = []

    def add(raw: str | None) -> None:
        if raw:
            for part in re.split(r"[,;]", unquote(raw)):
                email = clean_email(part)
                if email and email not in found:
                    found.append(email)

    root = doc.root
    if root is not None:
        for a in root.iter("a", "area"):
            href = (a.get("href") or "").strip()
            if href.lower().startswith("mailto:"):
                add(href[7:].split("?", 1)[0])
            match = _CF_HREF_RE.search(href)
            if match:
                add(decode_cf_email(match.group(1)))
        for el in root.xpath("//*[@data-cfemail]"):
            add(decode_cf_email(el.get("data-cfemail") or ""))
    for match in EMAIL_RE.finditer(doc.text):
        add(match.group(0))
    for key, value in _walk(doc.page.structured or {}):
        if key.rsplit("/", 1)[-1] == "email" and isinstance(value, str):
            add(value)
    return found


# ------------------------------------------------------------------- forms

_SEARCH_NAMES = frozenset({"s", "q", "query", "search", "keyword", "keywords", "search_query", "searchterm"})
_PAYMENT_RE = re.compile(r"card|cc-|credit|payment|checkout|stripe|paypal|cvv|cvc|billing", re.IGNORECASE)
_NEWSLETTER_RE = re.compile(
    r"newsletter|subscribe|signup|sign-up|mailchimp|mc-embedded|list-manage|klaviyo|constantcontact|mailerlite"
    r"|convertkit|sendinblue|brevo",
    re.IGNORECASE,
)
_MESSAGE_RE = re.compile(r"message|comment|inquiry|enquiry|question|how can we help|details|describe", re.IGNORECASE)


def _is_contact_form(form) -> bool:
    attrs = " ".join(filter(None, (form.get(a) for a in ("id", "class", "name", "action", "role", "aria-label")))).lower()
    fields = [el for el in form.iter("input", "textarea", "select")]
    types = [(el.get("type") or "text").strip().lower() for el in fields if el.tag == "input"]
    names = [(el.get("name") or "").strip().lower() for el in fields]
    described = " ".join(
        filter(None, (el.get(a) for el in fields for a in ("name", "id", "placeholder", "autocomplete", "aria-label")))
    ).lower()
    if "password" in types:
        return False  # login or sign-up
    if (form.get("role") or "").lower() == "search" or "search" in types or re.search(r"\bsearch\b", attrs):
        return False
    if any(name in _SEARCH_NAMES for name in names):
        return False
    if _PAYMENT_RE.search(attrs) or _PAYMENT_RE.search(described):
        return False
    if "comment" in attrs or "wp-comments-post" in attrs:
        return False  # blog comments
    has_textarea = any(el.tag == "textarea" for el in fields)
    has_message = bool(_MESSAGE_RE.search(described))
    has_email = "email" in types or bool(re.search(r"e-?mail", described))
    if not (has_textarea or has_message or has_email):
        return False
    if not has_textarea and _NEWSLETTER_RE.search(attrs + " " + described):
        return False
    if not has_textarea and not has_message:
        visible = [t for t in types if t not in ("hidden", "submit", "button", "image", "reset", "checkbox", "radio")]
        if len(visible) + sum(1 for el in fields if el.tag == "select") < 3:
            return False  # an email-only box is a sign-up, not a way to write to the business
    return True


def _has_contact_form(doc) -> bool:
    return doc.root is not None and any(_is_contact_form(form) for form in doc.root.iter("form"))


# ------------------------------------------------------------------ finder


@dataclass
class _Candidate:
    rank: tuple
    email: str | None
    page: PageResult | None
    label: str | None
    skip_note: str | None = None


def _page_rank(label: str) -> int:
    return 0 if label == "Contact page" else 1 if label == "Home page" else 2


def _is_hostless(domain: str) -> bool:
    if domain == "localhost" or domain.endswith(".localhost"):
        return True
    try:
        ipaddress.ip_address(domain)
        return True
    except ValueError:
        return False


def find_contact(*, listing_emails: list[str], website: str | None, pages: list[PageResult],
                 listing_label: str) -> ContactResult:
    """The business's email (own-domain site email > listing email > other site email) or else a
    contact form, with its source. Never guesses an address."""
    docs = page_docs(list(pages or []))
    own_domains = {registrable_domain(website)} if website else set()
    own_domains |= {registrable_domain(doc.page.final_url or doc.page.url) for doc in docs}
    own_domains.discard("")
    # A site served from an IP address or localhost (local fixtures) has no domain to compare with,
    # so the addresses it publishes count as its own.
    hostless_site = any(_is_hostless(registrable_domain(doc.page.final_url or doc.page.url)) for doc in docs)

    emails: list[_Candidate] = []
    forms: list[_Candidate] = []
    contact_page_says_no = False
    for order, doc in enumerate(docs):
        page = doc.page
        label = page_label(page.final_url or page.url, page.title)
        no_solicit = says_no_solicitations(doc.text)
        no_harvest = bool(_NO_HARVEST_RE.search(doc.text))
        if no_solicit and label == "Contact page":
            contact_page_says_no = True
        solicit_note = NOTE_NO_SOLICITATIONS if label == "Contact page" else NOTE_NO_SOLICITATIONS_OTHER
        email_note = solicit_note if no_solicit else NOTE_NO_HARVESTING if no_harvest else None
        for position, email in enumerate(_page_emails(doc)):
            local, domain = email.rsplit("@", 1)
            tier = 0 if hostless_site or registrable_domain(domain) in own_domains else 3
            role = 0 if local in ROLE_LOCAL_PARTS else 1
            rank = (tier, _page_rank(label), role, order, position)
            emails.append(_Candidate(rank, email, page, label, email_note))
        if _has_contact_form(doc):
            rank = (_page_rank(label), order)
            forms.append(_Candidate(rank, None, page, label, solicit_note if no_solicit else None))

    for position, raw in enumerate(listing_emails or []):
        email = clean_email(raw)
        if email is None:
            continue
        tier = 1 if registrable_domain(email.rsplit("@", 1)[1]) in own_domains else 2
        emails.append(_Candidate((tier, 9, 0, 0, position), email, None, None))

    if contact_page_says_no:
        return ContactResult(kind="none", note=NOTE_NO_SOLICITATIONS)

    note: str | None = None
    allowed = sorted((c for c in emails if c.skip_note is None), key=lambda c: c.rank)
    skipped = sorted((c for c in emails if c.skip_note is not None), key=lambda c: c.rank)
    best = allowed[0] if allowed else None
    if skipped and (best is None or (skipped[0].rank < best.rank and skipped[0].email != best.email)):
        note = skipped[0].skip_note
    if best is not None:
        if best.page is None:
            return ContactResult(kind="email", email=best.email, source_kind="listing", source_url=None,
                                 source_label=listing_label, seen_at=None, note=note)
        return ContactResult(kind="email", email=best.email, source_kind="site",
                             source_url=best.page.final_url or best.page.url, source_label=best.label,
                             seen_at=best.page.fetched_at, note=note)

    allowed_forms = sorted((c for c in forms if c.skip_note is None), key=lambda c: c.rank)
    skipped_forms = sorted((c for c in forms if c.skip_note is not None), key=lambda c: c.rank)
    if skipped_forms and (not allowed_forms or skipped_forms[0].rank < allowed_forms[0].rank):
        note = note or skipped_forms[0].skip_note
    if allowed_forms:
        form = allowed_forms[0]
        url = form.page.final_url or form.page.url
        return ContactResult(kind="form", form_url=url, source_kind="site", source_url=url,
                             source_label=form.label, seen_at=form.page.fetched_at, note=note)
    return ContactResult(kind="none", note=note)
