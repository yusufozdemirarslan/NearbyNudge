"""Email text helpers: footer (WR2), plain text, mailto links, sentence splitting and rule checks (WR1)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

WORD_MIN = 80
WORD_MAX = 130
SUBJECT_MAX_WORDS = 9  # "under 10 words"

OPT_OUT_LINE = 'Not interested? Reply "no thanks" and I won\'t email again.'

_ABBREVIATIONS = {
    "dr", "mr", "mrs", "ms", "st", "jr", "sr", "inc", "ltd", "co", "corp", "llc", "e.g", "i.e", "etc",
    "vs", "mt", "ft", "ave", "blvd", "rd", "no", "u.s", "a.m", "p.m", "dds", "dmd", "esq", "ph.d", "prof",
    "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun", "jan", "feb", "mar", "apr", "jun",
    "jul", "aug", "sep", "sept", "oct", "nov", "dec", "approx", "dept", "est", "ste", "fl",
}

SPAM_PHRASES = [
    "act now", "limited time", "100% free", "risk-free", "risk free", "click here", "buy now", "urgent",
    "winner", "once in a lifetime", "cash bonus", "best price", "guaranteed", "100% guaranteed",
    "no strings attached", "double your", "earn money", "special promotion", "this is not spam",
    "$$$", "!!!", "dear friend", "free money", "amazing deal", "exclusive deal",
]

CLICHES = [
    "i hope this email finds you well", "i hope this finds you well", "hope you're doing well",
    "hope you are doing well", "touch base", "circle back", "synergy", "game-changer", "game changer",
    "revolutionize", "cutting-edge", "cutting edge", "next level", "in today's fast-paced",
    "i wanted to reach out", "just checking in", "low-hanging fruit", "move the needle", "win-win",
    "think outside the box", "world-class", "best-in-class", "leverage our", "unlock your potential",
]

FAMILIARITY = [
    "i stopped by", "i visited your office", "i was in your office", "we met", "as we discussed",
    "great to meet", "nice meeting you", "i walked by", "i drove by", "when i was in",
]

_PLACEHOLDER_RE = re.compile(
    r"\[[^\]]{1,40}\]|\{\{|\}\}|\{[a-z_ ]{2,30}\}|<[a-z_ ]{2,30}>|\bTODO\b|lorem ipsum|\bXXX+\b|\bINSERT\b|\bTBD\b",
    re.IGNORECASE,
)
_BULLET_RE = re.compile(r"^\s*([-*•▪◦·]|\d+[.)])\s+", re.MULTILINE)

_NAME_SUFFIXES = {
    "llc", "l.l.c", "pllc", "llp", "lp", "pc", "p.c", "inc", "ltd", "corp", "co", "dds", "dmd", "md", "pa", "p.a",
    "cpa", "esq", "ms", "phd", "ph.d",
}
_GENERIC_TOKENS = {
    "dental", "dentistry", "dentist", "family", "care", "center", "centre", "group", "associates", "and", "of",
    "clinic", "services", "service", "office", "practice", "studio", "company", "the", "&", "llc", "inc",
}


def count_words(text: str) -> int:
    return len([t for t in re.split(r"\s+", text.strip()) if re.search(r"[A-Za-z0-9]", t)])


def split_sentences(text: str) -> list[str]:
    """Split a paragraph into sentences, keeping abbreviations like "Dr." intact."""
    text = " ".join(text.split())
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])[\"”’)]?\s+(?=[\"“(]?[A-Z0-9])", text)
    out: list[str] = []
    for part in parts:
        if out:
            prev = out[-1]
            last_word = prev.rstrip(".").split(" ")[-1].lower().strip("(\"“")
            if prev.endswith(".") and (last_word in _ABBREVIATIONS or (len(last_word) == 1 and last_word.isalpha())):
                out[-1] = f"{prev} {part}"
                continue
        out.append(part)
    return [p.strip() for p in out if p.strip()]


def short_business_name(name: str) -> str:
    """The name to use in a subject or greeting: drops a ' - tagline' part and trailing legal
    suffixes or credentials ("Sample Dental Studio, PC" -> "Sample Dental Studio"), never inner words."""
    base = re.split(r"\s+[-–|:]\s+", name)[0]
    tokens = base.replace(",", " , ").split()
    while tokens:
        last = tokens[-1].lower().strip(",").rstrip(".")
        if last in _NAME_SUFFIXES or tokens[-1] in (",", "&"):
            tokens.pop()
            continue
        break
    out = " ".join(tokens).replace(" ,", ",").strip(" ,.-")
    return out or name.strip()


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return " ".join(re.sub(r"[^a-z0-9'& ]+", " ", text).split())


def names_business(subject: str, business_name: str) -> bool:
    subj = _norm(subject)
    short = _norm(short_business_name(business_name))
    if short and short in subj:
        return True
    tokens = [t for t in short.split() if t not in _GENERIC_TOKENS and len(t) > 1]
    if not tokens:
        tokens = short.split()
    hits = sum(1 for t in tokens if re.search(rf"\b{re.escape(t)}\b", subj))
    return bool(tokens) and hits / len(tokens) >= 0.6


# ---------- footer, body, copy text, mailto ----------

def build_footer(profile: dict[str, Any] | None) -> str:
    if not profile:
        return ""
    name = profile.get("sender_name", "").strip()
    title = profile.get("sender_title", "").strip()
    company = profile.get("sender_company", "").strip()
    address = profile.get("sender_address", "").strip()
    line2 = f"{title}, {company}" if title else company
    lines = [name, line2, *[ln for ln in address.splitlines() if ln.strip()]]
    lines += ["", f"This email is a business offer from {company}.", OPT_OUT_LINE]
    return "\n".join(lines)


def paragraph_text(paragraph: list[dict[str, Any]]) -> str:
    return " ".join(s["text"].strip() for s in paragraph if s.get("text", "").strip())


def body_text(greeting: str, paragraphs: list[list[dict[str, Any]]], signoff: str) -> str:
    parts = [greeting.strip()] if greeting.strip() else []
    parts += [paragraph_text(p) for p in paragraphs if paragraph_text(p)]
    if signoff.strip():
        parts.append(signoff.strip())
    return "\n\n".join(parts)


def email_word_count(greeting: str, paragraphs: list[list[dict[str, Any]]], signoff: str) -> int:
    return count_words(body_text(greeting, paragraphs, signoff))


def full_text(greeting: str, paragraphs: list[list[dict[str, Any]]], signoff: str, footer: str) -> str:
    body = body_text(greeting, paragraphs, signoff)
    return f"{body}\n{footer}" if footer else body


def copy_text(subject: str, greeting: str, paragraphs: list[list[dict[str, Any]]], signoff: str, footer: str) -> str:
    return f"Subject: {subject}\n\n{full_text(greeting, paragraphs, signoff, footer)}"


def mailto_url(to: str, subject: str, text: str) -> str:
    """RFC 6068 mailto link; only subject and body are reliable across email apps."""
    body = text.replace("\r\n", "\n").replace("\n", "\r\n")
    return f"mailto:{quote(to, safe='@')}?subject={quote(subject, safe='')}&body={quote(body, safe='')}"


# ---------- user edits ----------

def parse_body(body: str) -> tuple[str, list[list[str]], str]:
    """Split edited body text into greeting, paragraphs of sentences and signoff."""
    text = body.replace("\r\n", "\n").replace("\r", "\n").strip()
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    greeting = ""
    signoff = ""
    if blocks and "\n" not in blocks[0] and len(blocks[0]) <= 80 and blocks[0].rstrip().endswith((",", ":")):
        greeting = blocks.pop(0)
    elif blocks:
        first_line, _, rest = blocks[0].partition("\n")
        if first_line.rstrip().endswith(",") and len(first_line) <= 80 and rest.strip():
            greeting = first_line.strip()
            blocks[0] = rest.strip()
    if blocks:
        last = blocks[-1]
        lines = last.splitlines()
        if len(lines) == 1 and len(last) <= 40 and last.rstrip().endswith(","):
            signoff = blocks.pop()
        elif len(lines) > 1 and len(lines[-1]) <= 40 and lines[-1].rstrip().endswith(","):
            signoff = lines[-1].strip()
            blocks[-1] = "\n".join(lines[:-1]).strip()
    paragraphs = [split_sentences(" ".join(b.split())) for b in blocks]
    return greeting, [p for p in paragraphs if p], signoff


# ---------- rule checks (code side of WR1 / QC1) ----------

@dataclass
class RuleIssue:
    key: str  # rules | spam | subject | facts
    message: str


def rule_checks(
    *, subject: str, greeting: str, paragraphs: list[list[dict[str, Any]]], signoff: str, business_name: str,
    known_fact_ids: set[str] | None = None,
) -> list[RuleIssue]:
    issues: list[RuleIssue] = []
    subj_words = count_words(subject)
    if subj_words == 0:
        issues.append(RuleIssue("subject", "The subject is empty."))
    elif subj_words > SUBJECT_MAX_WORDS:
        issues.append(RuleIssue("subject", f"The subject has {subj_words} words; keep it under 10."))
    if subject and not names_business(subject, business_name):
        issues.append(RuleIssue("subject", "The subject should name the business."))
    words = email_word_count(greeting, paragraphs, signoff)
    if words < WORD_MIN:
        issues.append(RuleIssue("rules", f"The email has {words} words; aim for {WORD_MIN}-{WORD_MAX}."))
    elif words > WORD_MAX:
        issues.append(RuleIssue("rules", f"The email has {words} words; aim for {WORD_MIN}-{WORD_MAX}."))
    text = body_text(greeting, paragraphs, signoff)
    all_text = f"{subject}\n{text}"
    if _BULLET_RE.search(text) or any(s.get("text", "").lstrip().startswith(("-", "*", "•")) for p in paragraphs for s in p):
        issues.append(RuleIssue("rules", "Remove bullet points; write in sentences."))
    if _PLACEHOLDER_RE.search(all_text):
        issues.append(RuleIssue("spam", "The email contains a placeholder."))
    raw_low = all_text.lower()
    for phrase in SPAM_PHRASES:
        if phrase[0].isalnum():
            found = re.search(rf"(?<![a-z0-9]){re.escape(phrase)}(?![a-z0-9])", raw_low) is not None
        else:
            found = phrase in raw_low
        if found:
            issues.append(RuleIssue("spam", f'Remove the spam-like phrase "{phrase}".'))
    for phrase in CLICHES:
        if phrase in raw_low.replace("’", "'"):
            issues.append(RuleIssue("rules", f'Remove the cliché "{phrase}".'))
    for phrase in FAMILIARITY:
        if phrase in raw_low.replace("’", "'"):
            issues.append(RuleIssue("rules", f'Remove invented familiarity ("{phrase}").'))
    if all_text.count("!") > 1:
        issues.append(RuleIssue("rules", "Use at most one exclamation mark."))
    if known_fact_ids is not None:
        for p in paragraphs:
            for s in p:
                unknown = [f for f in s.get("fact_ids", []) if f not in known_fact_ids]
                if unknown:
                    issues.append(RuleIssue("facts", "A sentence cites a fact that doesn't exist."))
                    break
    return issues


def strip_markdown(text: str) -> str:
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"(?<!\w)\*(\S.+?)\*(?!\w)", r"\1", text)
    return text.strip()
