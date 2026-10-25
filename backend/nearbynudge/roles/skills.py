"""Loads the role instructions (skills/<role>/SKILL.md) and renders shared prompt pieces."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

from .outputs import EmailOut

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"

_FRONTMATTER = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)


@lru_cache
def skill_text(name: str) -> str:
    """The instruction body of a skill (frontmatter removed). Stable text, so it caches well."""
    raw = (SKILLS_DIR / name / "SKILL.md").read_text(encoding="utf-8")
    return _FRONTMATTER.sub("", raw, count=1).strip()


def today_line(today: date | None = None) -> str:
    d = today or date.today()
    return f"Today's date: {d:%A, %B} {d.day}, {d.year}."


@dataclass
class PromptFact:
    pid: str  # "F1"
    text: str
    quote: str
    source: str  # "About page (https://...)", "Site check of the home page", "Business listing (Overture Maps)"


def render_facts(facts: list[PromptFact]) -> str:
    if not facts:
        return "(no facts recorded)"
    lines = []
    for f in facts:
        quote = f' Quote: "{f.quote}"' if f.quote else ""
        lines.append(f"{f.pid}. {f.text} [Source: {f.source}]{quote}")
    return "\n".join(lines)


def business_block(b: dict[str, Any]) -> str:
    parts = [
        f"Name: {b.get('name')}",
        f"Short name for the subject and greeting: {b.get('short_name') or b.get('name')}",
        f"Category: {b.get('category_label') or 'unknown'}",
        f"Address: {b.get('address') or 'not listed'}",
        f"Distance from the sender's area: {b.get('distance_mi')} mi",
        f"Website: {b.get('website') or 'none listed'}",
    ]
    if b.get("summary"):
        parts.append(f"What it does (from research): {b['summary']}")
    if b.get("owner_name"):
        parts.append(f"Published owner or lead practitioner: {b['owner_name']}")
    return "\n".join(parts)


def offer_block(offer: dict[str, Any], sender: dict[str, Any] | None = None) -> str:
    parts = [
        f"What the sender sells: {offer.get('offer_what')}",
        f"Proof point: {offer.get('offer_proof') or '(none given; make no claims about past results)'}",
        f"The ask (call to action): {offer.get('offer_cta')}",
        f"Tone: {offer.get('tone', 'professional')}",
    ]
    if sender:
        name = sender.get("sender_name")
        company = sender.get("sender_company")
        if name or company:
            parts.append(f"Sender: {name or ''}{', ' if name and company else ''}{company or ''}")
    return "\n".join(parts)


def render_email(email: EmailOut) -> tuple[str, list[str]]:
    """Render an email with sentence ids (S1...) for the editor or a rewrite. Returns (text, ids)."""
    lines = [f"Subject: {email.subject}", f"Greeting: {email.greeting}"]
    ids: list[str] = []
    n = 0
    for pi, para in enumerate(email.paragraphs, 1):
        lines.append(f"Paragraph {pi}:")
        for s in para:
            n += 1
            sid = f"S{n}"
            ids.append(sid)
            cites = f"; cites {', '.join(s.fact_ids)}" if s.fact_ids else ""
            lines.append(f"  {sid} [{s.kind}{cites}]: {s.text}")
    lines.append(f"Sign-off: {email.signoff}")
    return "\n".join(lines), ids
