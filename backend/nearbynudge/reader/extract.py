"""Turn fetched HTML into text, links, structured data and page metadata (code only, no AI)."""

from __future__ import annotations

import codecs
import json
import logging
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import lxml.html

from .types import STRUCTURED_SYNTAXES, Link, empty_meta, empty_structured
from .urls import is_file_url, normalize_url, registrable_domain

log = logging.getLogger(__name__)

MIN_MAIN_TEXT_CHARS = 200

# ------------------------------------------------------------------ decoding

_HTTP_CHARSET_RE = re.compile(r"charset\s*=\s*[\"']?\s*([A-Za-z0-9._:-]+)", re.IGNORECASE)
_META_CHARSET_RE = re.compile(rb"<meta[^>]+charset\s*=\s*[\"']?\s*([A-Za-z0-9._:-]+)", re.IGNORECASE)
_XML_DECL_RE = re.compile(r"^\s*<\?xml[^>]*\?>", re.IGNORECASE)
# WHATWG: these labels mean windows-1252 in browsers.
_ENCODING_ALIASES = {
    "iso-8859-1": "cp1252", "iso8859-1": "cp1252", "latin1": "cp1252", "latin-1": "cp1252", "l1": "cp1252",
    "us-ascii": "cp1252", "ascii": "cp1252", "windows-1252": "cp1252", "x-cp1252": "cp1252",
    "utf8": "utf-8", "unicode-1-1-utf-8": "utf-8",
}


def _codec(label: str | None) -> str | None:
    if not label:
        return None
    name = _ENCODING_ALIASES.get(label.strip().strip("\"'").lower(), label.strip().strip("\"'").lower())
    try:
        return codecs.lookup(name).name
    except LookupError:
        return None


def decode_body(body: bytes, content_type: str | None = None) -> str:
    """Decode with the BOM, then the HTTP charset, then the meta charset, then UTF-8 with replacement."""
    if body.startswith(codecs.BOM_UTF8):
        return body[len(codecs.BOM_UTF8) :].decode("utf-8", "replace")
    if body.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return body.decode("utf-16", "replace")
    match = _HTTP_CHARSET_RE.search(content_type or "")
    codec = _codec(match.group(1)) if match else None
    if codec is None:
        meta = _META_CHARSET_RE.search(body[:8192])
        codec = _codec(meta.group(1).decode("ascii", "ignore")) if meta else None
        if codec and codec.startswith("utf-16"):  # a meta tag read as ASCII cannot be UTF-16
            codec = "utf-8"
    return body.decode(codec or "utf-8", "replace")


def looks_like_html(body: bytes) -> bool:
    head = body[:1024].lstrip().lower()
    return head.startswith((b"<!doctype html", b"<html", b"<head", b"<body", b"<?xml", b"<!--", b"<meta", b"<title"))


def parse_document(html: str):
    """Parse HTML into an lxml root element; None if there is nothing to parse."""
    if not html or not html.strip():
        return None
    text = _XML_DECL_RE.sub("", html, count=1).replace("\x00", "")
    try:
        parser = lxml.html.HTMLParser(huge_tree=True)
        return lxml.html.document_fromstring(text, parser=parser)
    except Exception:  # empty or hopeless markup
        return None


# -------------------------------------------------------------- visible text

_SKIP_TAGS = frozenset(
    {
        "script", "style", "noscript", "template", "svg", "math", "iframe", "object", "embed", "canvas",
        "video", "audio", "select", "datalist", "head", "title", "meta", "link",
    }
)
_BLOCK_TAGS = frozenset(
    {
        "address", "article", "aside", "blockquote", "body", "caption", "dd", "details", "dialog", "div", "dl", "dt",
        "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup",
        "hr", "legend", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "tfoot",
        "thead", "tr", "ul", "center",
    }
)
_HIDDEN_STYLE_RE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.IGNORECASE)


def _tag(el) -> str | None:
    tag = el.tag
    if not isinstance(tag, str):
        return None
    return tag.rsplit("}", 1)[-1].lower()


def _is_hidden(el) -> bool:
    if el.get("hidden") is not None:
        return True
    if (el.get("type") or "").lower() == "hidden":
        return True
    style = el.get("style")
    return bool(style and _HIDDEN_STYLE_RE.search(style))


def visible_text(el) -> str:
    """Text a visitor would see in `el`, one block per line (scripts, styles and hidden parts dropped)."""
    if el is None:
        return ""
    parts: list[str] = []
    stack: list[tuple[object, bool]] = [(el, False)]
    while stack:
        node, closing = stack.pop()
        tag = _tag(node)
        if closing:
            if tag in _BLOCK_TAGS:
                parts.append("\n")
            elif tag in ("td", "th"):
                parts.append(" ")
            if node is not el and node.tail:
                parts.append(node.tail)
            continue
        if tag is None or tag in _SKIP_TAGS or _is_hidden(node):
            if node is not el and node.tail:
                parts.append(node.tail)
            continue
        if tag in _BLOCK_TAGS or tag == "br":
            parts.append("\n")
        if node.text:
            parts.append(node.text)
        stack.append((node, True))
        for child in reversed(node):
            stack.append((child, False))
    lines = (" ".join(line.split()) for line in "".join(parts).split("\n"))
    return "\n".join(line for line in lines if line)


def document_text(root) -> str:
    if root is None:
        return ""
    body = root.find("body")
    return visible_text(body if body is not None else root)


_FOOTER_ATTR_RE = re.compile(r"(?:^|[\s_-])(?:footer|colophon)(?:$|[\s_-])", re.IGNORECASE)


def footer_text(root) -> str:
    """Visible text of footers and <address> blocks (where small sites keep address, hours and ©)."""
    if root is None:
        return ""
    selected: list = []  # keeping references keeps lxml's element proxies (and identities) stable
    chosen: set = set()
    for el in root.iter():
        tag = _tag(el)
        if tag is None or tag in _SKIP_TAGS:
            continue
        attrs = f"{el.get('id') or ''} {el.get('class') or ''}"
        if not (
            tag in ("footer", "address")
            or (el.get("role") or "").lower() == "contentinfo"
            or (tag in ("div", "section", "aside") and _FOOTER_ATTR_RE.search(attrs))
        ):
            continue
        if any(anc in chosen for anc in el.iterancestors()):
            continue
        chosen.add(el)
        selected.append(el)
    return "\n".join(t for t in (visible_text(el) for el in selected) if t)


# ------------------------------------------------------------------ metadata


def _collapse(value: str | None) -> str:
    return " ".join((value or "").split())


def extract_title(root) -> str:
    if root is None:
        return ""
    title = root.find(".//head/title")
    if title is None:
        title = root.find(".//title")
    return _collapse(title.text_content()) if title is not None else ""


def extract_meta(root) -> dict:
    meta = empty_meta()
    if root is None:
        return meta
    for el in root.iter("meta"):
        name = (el.get("name") or "").strip().lower()
        if name in ("viewport", "description", "generator") and meta[name] is None:
            content = el.get("content")
            if content is not None:
                meta[name] = _collapse(content)
    html_el = root if _tag(root) == "html" else root.find(".//html")
    if html_el is not None:
        lang = html_el.get("lang") or html_el.get("{http://www.w3.org/XML/1998/namespace}lang") or html_el.get("xml:lang")
        meta["lang"] = lang.strip() if lang and lang.strip() else None
    return meta


# --------------------------------------------------------------------- links

_NON_PAGE_SCHEMES = ("mailto:", "tel:", "javascript:", "data:", "sms:", "fax:", "callto:", "skype:", "whatsapp:", "geo:", "file:", "ftp:")


def base_url_of(root, page_url: str) -> str:
    if root is not None:
        base = root.find(".//base[@href]")
        if base is not None:
            try:
                return urljoin(page_url, base.get("href").strip())
            except ValueError:
                pass
    return page_url


def anchor_text(a) -> str:
    """Visible link text, with block children ("About us" / "Learn our story") separated by spaces."""
    text = " ".join(visible_text(a).split("\n")).strip()
    if text:
        return text
    for attr in ("aria-label", "title"):
        if a.get(attr):
            return _collapse(a.get(attr))
    img = a.find(".//img[@alt]")
    return _collapse(img.get("alt")) if img is not None else ""


def iter_hrefs(root, page_url: str):
    """Yield (absolute_url, element) for every <a>/<area> href that points at a web page (any site)."""
    if root is None:
        return
    base = base_url_of(root, page_url)
    for a in root.iter("a", "area"):
        href = (a.get("href") or "").strip()
        if not href or href.startswith("#") or href.lower().startswith(_NON_PAGE_SCHEMES):
            continue
        try:
            absolute = urljoin(base, href)
            parts = urlsplit(absolute)
        except ValueError:
            continue
        if parts.scheme not in ("http", "https") or not parts.hostname:
            continue
        yield absolute, a


def extract_links(root, page_url: str) -> list[Link]:
    """Same-site page links: absolute, normalized, deduped; no files, mail/phone links or /cdn-cgi/."""
    site = registrable_domain(page_url)
    links: list[Link] = []
    index: dict[str, int] = {}
    for absolute, a in iter_hrefs(root, page_url):
        if registrable_domain(absolute) != site or is_file_url(absolute):
            continue
        if "/cdn-cgi/" in urlsplit(absolute).path:
            continue
        url = normalize_url(absolute)
        text = anchor_text(a)
        if url in index:
            existing = links[index[url]]
            if not existing.text and text:
                existing.text = text
            continue
        index[url] = len(links)
        links.append(Link(url=url, text=text))
    return links


# ---------------------------------------------------------- structured data

_TRAILING_COMMA_RE = re.compile(r",\s*([}\]])")


def _jsonld_fallback(root) -> list:
    """Parse each JSON-LD block on its own so one broken block doesn't hide the others."""
    items: list = []
    if root is None:
        return items
    for script in root.iter("script"):
        if (script.get("type") or "").strip().lower() != "application/ld+json":
            continue
        raw = (script.text or "").strip()
        if not raw:
            continue
        for candidate in (raw, _TRAILING_COMMA_RE.sub(r"\1", raw)):
            try:
                data = json.loads(candidate, strict=False)
            except ValueError:
                continue
            items.extend(data if isinstance(data, list) else [data])
            break
    return items


def extract_structured(html: str, base_url: str, root=None) -> dict:
    """extruct json-ld, microdata and opengraph (uniform); never raises."""
    out = empty_structured()
    if not html:
        return out
    try:
        import extruct
    except Exception:  # pragma: no cover
        out["json-ld"] = _jsonld_fallback(root)
        return out
    try:
        data = extruct.extract(html, base_url=base_url, syntaxes=list(STRUCTURED_SYNTAXES), uniform=True)
        for key in STRUCTURED_SYNTAXES:
            out[key] = list(data.get(key) or [])
        return out
    except Exception:
        log.debug("structured data: combined extract failed for %s", base_url, exc_info=True)
    for key in STRUCTURED_SYNTAXES:
        try:
            data = extruct.extract(html, base_url=base_url, syntaxes=[key], uniform=True)
            out[key] = list(data.get(key) or [])
        except Exception:
            out[key] = _jsonld_fallback(root) if key == "json-ld" else []
    return out


# ------------------------------------------------------- bot checks, logins

_BOT_TITLES = (
    "just a moment", "attention required", "checking your browser", "one more step", "ddos-guard",
    "ddos protection", "security check", "verify you are human", "verify you are a human", "are you a robot",
    "human verification", "bot verification", "pardon our interruption", "you have been blocked",
    "request unsuccessful", "sgcaptcha", "captcha challenge",
)


def _is_bot_title(title: str) -> bool:
    t = " ".join((title or "").split()).lower()
    if not t:
        return False
    if "cloudflare" in t and any(p in t for p in ("please wait", "access denied", "attention required", "just a moment")):
        return True
    for phrase in _BOT_TITLES:
        if t.startswith(phrase):
            rest = t[len(phrase) :].lstrip(" .…!?")
            if not rest or rest[0] in "|-–—:":
                return True
    return False
_BOT_STRONG_MARKERS = (
    "_cf_chl_opt", "cf_chl_", "cf-chl-", "/cdn-cgi/challenge-platform/h/", "cf-browser-verification",
    "checking your browser before accessing", "checking if the site connection is secure",
    "enable javascript and cookies to continue", "_incapsula_resource", "incapsula incident id",
    "captcha-delivery.com", "px-captcha", "_pxcaptcha", "sucuri website firewall", "ddos-guard",
    "awswafintegration", "aws-waf-token", "gokuprops", "/.well-known/sgcaptcha",
    "your access to this site has been limited by the site owner", "why have i been blocked",
)
_BOT_WEAK_MARKERS = (
    "challenge-platform", "g-recaptcha", "recaptcha/api.js", "h-captcha", "hcaptcha.com", "cf-turnstile",
    "challenges.cloudflare.com", "captcha",
)


def is_bot_check(html_lower: str, title: str, visible_chars: int, status: int | None) -> bool:
    """Challenge pages (Cloudflare and others) and captcha-only pages. We never try to get past them."""
    if _is_bot_title(title):
        return True
    if any(marker in html_lower for marker in _BOT_STRONG_MARKERS):
        return True
    if any(marker in html_lower for marker in _BOT_WEAK_MARKERS):
        return visible_chars < 400 or status in (403, 429, 503)
    return False


def has_password_field(root) -> bool:
    if root is None:
        return False
    return any((el.get("type") or "").strip().lower() == "password" for el in root.iter("input"))


def is_login_page(root, html_lower: str, visible_chars: int, main_chars: int) -> bool:
    """A page whose main content is a password form (login walls, password-protected pages)."""
    if not has_password_field(root):
        return False
    if "post-password-form" in html_lower:
        return True
    return visible_chars < 800 or main_chars < 150


# ----------------------------------------------------------------- main text


def _extract_main(html: str, url: str) -> str:
    try:
        import trafilatura

        text = trafilatura.extract(html, include_comments=False, include_tables=True, favor_recall=True, url=url)
    except Exception:
        log.debug("trafilatura failed for %s", url, exc_info=True)
        text = None
    return (text or "").strip()


def _norm_line(line: str) -> str:
    return " ".join(line.split()).casefold()


def main_text(html: str, url: str, root, full_text: str | None = None) -> str:
    """trafilatura's main text plus footer/address lines it dropped; visible text when it finds too little."""
    text = _extract_main(html, url)
    if len(text) < MIN_MAIN_TEXT_CHARS:
        fallback = full_text if full_text is not None else document_text(root)
        return fallback if len(fallback) > len(text) else text
    seen = _norm_line(text)
    extra: list[str] = []
    for line in footer_text(root).split("\n"):
        key = _norm_line(line)
        if key and key not in seen:
            extra.append(line.strip())
            seen += "\n" + key
    if extra:
        text = text + "\n" + "\n".join(extra)
    return text


@dataclass
class Analysis:
    title: str = ""
    text: str = ""
    links: list[Link] = field(default_factory=list)
    structured: dict = field(default_factory=empty_structured)
    meta: dict = field(default_factory=empty_meta)
    error: str | None = None  # "bot_check" | "login_page" | None


def analyze(html: str, final_url: str, status: int | None = None) -> Analysis:
    """Everything the reader extracts from one HTML page. Never raises."""
    try:
        root = parse_document(html)
        title = extract_title(root)
        full = document_text(root)
        html_lower = html.lower()
        if is_bot_check(html_lower, title, len(full), status):
            return Analysis(title=title, error="bot_check")
        if status is not None and status >= 400:
            return Analysis(title=title, error=None)
        text = main_text(html, final_url, root, full_text=full)
        if is_login_page(root, html_lower, len(full), len(text)):
            return Analysis(title=title, error="login_page")
        return Analysis(
            title=title,
            text=text,
            links=extract_links(root, final_url),
            structured=extract_structured(html, final_url, root),
            meta=extract_meta(root),
        )
    except Exception:  # pragma: no cover - defensive: a parser bug must not break a lead
        log.exception("could not analyze %s", final_url)
        return Analysis()
