"""URL helpers: registrable domains, normalization and file-type checks."""

from __future__ import annotations

import functools
import ipaddress
import re
from urllib.parse import unquote, urlsplit, urlunsplit

import idna

try:  # The `tld` package ships the Public Suffix List and works offline.
    from tld import get_fld as _tld_get_fld

    if _tld_get_fld("http://www.example.co.uk/", fail_silently=True) != "example.co.uk":
        _tld_get_fld = None
except Exception:  # pragma: no cover - only when `tld` is missing or broken
    _tld_get_fld = None

# Fallback when `tld` is unavailable: common multi-part public suffixes.
_MULTI_PART_SUFFIXES = frozenset(
    {
        "co.uk", "org.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk", "me.uk", "net.uk", "sch.uk",
        "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
        "co.nz", "org.nz", "net.nz", "govt.nz", "ac.nz",
        "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
        "com.br", "net.br", "org.br", "com.mx", "org.mx", "gob.mx", "com.ar", "com.co",
        "co.za", "org.za", "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in",
        "com.cn", "net.cn", "org.cn", "com.hk", "com.sg", "com.tw", "co.kr", "or.kr",
        "com.tr", "com.my", "com.ph", "com.pk", "com.ng", "co.il", "co.th", "co.id",
        "us.com", "uk.com", "eu.com", "github.io", "blogspot.com", "herokuapp.com",
    }
)

DEFAULT_PORTS = {"http": 80, "https": 443}

_TRACKING_PARAMS = frozenset(
    {"fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "yclid", "mc_cid", "mc_eid", "_hsenc", "_hsmi"}
)

FILE_EXTENSIONS = frozenset(
    {
        "pdf", "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tif", "tiff", "heic", "avif",
        "zip", "rar", "7z", "gz", "tgz", "tar", "bz2", "xz",
        "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "csv", "txt", "pages", "key",
        "mp3", "mp4", "m4a", "m4v", "mov", "avi", "wmv", "wav", "webm", "mkv", "ogg", "flac", "flv",
        "exe", "dmg", "msi", "apk", "iso", "bin", "ics", "vcf", "epub", "psd", "ai", "eps",
        "xml", "rss", "atom", "json", "js", "css", "woff", "woff2", "ttf", "otf", "eot", "map",
    }
)


def ascii_host(host: str) -> str:
    """An international host name in the ASCII (punycode) form httpx connects to: "www.café.com" ->
    "www.xn--caf-dma.com", so both spellings compare equal. ASCII or invalid names come back as they are."""
    if not host or host.isascii():
        return host
    try:
        return idna.encode(host.lower()).decode("ascii")  # the call httpx makes for the request
    except (idna.IDNAError, UnicodeError, ValueError):
        return host


def host_of(url_or_host: str) -> str:
    """Lowercased hostname (no port, no brackets) of a URL or bare host, international names in their
    ASCII form; "" when there is none."""
    s = (url_or_host or "").strip()
    if not s:
        return ""
    if "://" not in s and not s.startswith("//"):
        s = "//" + s
    try:
        host = urlsplit(s).hostname or ""
    except ValueError:
        return ""
    return ascii_host(host.rstrip(".").lower())


@functools.lru_cache(maxsize=8192)
def _registrable(host: str) -> str:
    if not host:
        return ""
    try:
        ipaddress.ip_address(host)
        return host
    except ValueError:
        pass
    if host == "localhost" or "." not in host:
        return host
    if _tld_get_fld is not None:
        try:
            fld = _tld_get_fld(host, fix_protocol=True, fail_silently=True)
        except Exception:
            fld = None
        if fld:
            return str(fld).lower()
    labels = host.split(".")
    if len(labels) >= 3 and ".".join(labels[-2:]) in _MULTI_PART_SUFFIXES:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def registrable_domain(url_or_host: str) -> str:
    """"https://www.samplestudio.example/x" -> "samplestudio.example"; IPs and localhost as-is."""
    return _registrable(host_of(url_or_host))


_DOMAIN_RE = re.compile(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+")


def is_domain(host: str) -> bool:
    """True for a host name with at least one dot and nothing but letters, digits and hyphens between the dots,
    like "example.com" (the dashboard's rule for a typed website)."""
    return bool(host) and _DOMAIN_RE.fullmatch(host) is not None


def _is_tracking_param(pair: str) -> bool:
    key = unquote(pair.split("=", 1)[0]).strip().lower()
    return key.startswith("utm_") or key in _TRACKING_PARAMS


def normalize_url(url: str) -> str:
    """Lowercase scheme and host, drop default ports, the fragment and tracking params; keep path and query.

    Any user:password@ part is dropped too, so the reader never sends credentials found in a link.
    """
    s = (url or "").strip()
    try:
        parts = urlsplit(s)
        port = parts.port
    except ValueError:
        return s.split("#", 1)[0]
    scheme = parts.scheme.lower()
    netloc = parts.netloc
    if netloc:
        host = (parts.hostname or "").rstrip(".")
        if ":" in host:
            host = f"[{host}]"
        if port is not None and DEFAULT_PORTS.get(scheme) != port:
            host = f"{host}:{port}"
        netloc = host
    path = parts.path
    if not path and netloc and scheme in DEFAULT_PORTS:
        path = "/"
    query = "&".join(p for p in parts.query.split("&") if p and not _is_tracking_param(p))
    return urlunsplit((scheme, netloc, path, query, ""))


def file_extension(url: str) -> str:
    try:
        path = urlsplit(url).path
    except ValueError:
        return ""
    last = unquote(path.rsplit("/", 1)[-1])
    if "." not in last:
        return ""
    return last.rsplit(".", 1)[-1].lower()


def is_file_url(url: str) -> bool:
    """True for links to downloads (PDFs, images, archives, documents, media, feeds...)."""
    return file_extension(url) in FILE_EXTENSIONS


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return normalize_url(urlunsplit((parts.scheme, parts.netloc, "", "", ""))).rstrip("/")
