"""Data types shared by the reader, the site check and the contact finder."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

READER_ERRORS: tuple[str, ...] = (
    "robots_disallowed",
    "robots_unreadable",
    "opted_out",
    "off_site",
    "blocked_address",
    "not_html",
    "too_large",
    "http_error",
    "timeout",
    "network",
    "bot_check",
    "login_page",
    "budget_exceeded",
)

STRUCTURED_SYNTAXES: tuple[str, ...] = ("json-ld", "microdata", "opengraph")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(value: datetime | None) -> str | None:
    """ISO 8601 in UTC with a trailing "Z" (seconds precision); None stays None."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def empty_structured() -> dict:
    return {key: [] for key in STRUCTURED_SYNTAXES}


def empty_meta() -> dict:
    return {"viewport": None, "description": None, "generator": None, "lang": None}


@dataclass
class Link:
    url: str
    text: str = ""


@dataclass
class PageResult:
    url: str  # requested URL (absolute, normalized)
    final_url: str  # after redirects (== url if none)
    ok: bool
    status: int | None = None
    error: str | None = None  # None when ok, else one of READER_ERRORS
    fetched_at: datetime = field(default_factory=utcnow)  # timezone-aware UTC
    load_ms: int = 0
    title: str = ""
    html: str = ""  # raw HTML, for code only (never sent to the AI)
    text: str = ""  # clean main text, unmasked
    links: list[Link] = field(default_factory=list)  # same-site links
    structured: dict = field(default_factory=empty_structured)
    meta: dict = field(default_factory=empty_meta)


class SiteBudget:
    """Pages one business may cost us. Every page request counts (robots.txt does not)."""

    def __init__(self, max_pages: int = 5):
        self.max_pages = int(max_pages)
        self.pages_used = 0

    @property
    def remaining(self) -> int:
        return max(0, self.max_pages - self.pages_used)

    def __repr__(self) -> str:
        return f"SiteBudget(max_pages={self.max_pages}, pages_used={self.pages_used})"
