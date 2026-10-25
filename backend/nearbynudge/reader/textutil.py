"""Text helpers: contact masking, quote checks and text-fragment links."""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from urllib.parse import quote as _percent_quote

EMAIL_RE = re.compile(
    r"(?<![\w.%+-])[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?![A-Za-z0-9-])"
)

# US/NANP phone numbers: (703) 555-0100, 703-555-0100, 703.555.0100, 703 555 0100,
# +1 703 555 0100, 1-800-555-0199, 7035550100, with an optional extension.
PHONE_RE = re.compile(
    r"""
    (?<![\w+$/.@-])
    (?:\+?1[\s.-]?)?
    (?:\(\s*[2-9]\d{2}\s*\)|[2-9]\d{2})
    [\s.-]?
    [2-9]\d{2}
    [\s.-]?
    \d{4}
    (?:\s*(?:x|ext\.?|extension)\s*\d{1,5})?
    (?![\d@])
    """,
    re.VERBOSE | re.IGNORECASE,
)

EMAIL_PLACEHOLDER = "[email]"
PHONE_PLACEHOLDER = "[phone]"
_PLACEHOLDER_RE = re.compile(r"\[(?:email|phone)\]", re.IGNORECASE)


def mask_contacts(text: str) -> str:
    """Replace email addresses with "[email]" and phone numbers with "[phone]"."""
    if not text:
        return text or ""
    masked = EMAIL_RE.sub(EMAIL_PLACEHOLDER, text)
    return PHONE_RE.sub(PHONE_PLACEHOLDER, masked)


# ---------------------------------------------------------------- quote checks

_CHAR_MAP = str.maketrans(
    {
        "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "´": "'", "`": "'",
        "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"', "«": '"', "»": '"',
        "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
        "…": "...",
        " ": " ", " ": " ", " ": " ",
        "​": "", "‌": "", "‍": "", "⁠": "", "﻿": "", "­": "",
    }
)
_EDGE_PUNCT = " \t\r\n.,;:!?'\"()[]{}<>-*_/\\|~"
_EDGE_PUNCT_KEEP_BRACKETS = _EDGE_PUNCT.replace("[]", "")
_NON_WORD_RE = re.compile(r"[^\w]+", re.UNICODE)
_NEGATIONS = frozenset({"not", "no", "never", "none", "nor", "cannot", "without", "t"})  # "t" from "isn't" etc.


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_CHAR_MAP).casefold()
    return " ".join(text.split())


def _depunct(text: str) -> str:
    return " ".join(_NON_WORD_RE.sub(" ", text).split())


def _same_meaning_markers(a: list[str], b: list[str]) -> bool:
    """A close match may differ in spacing or punctuation, never in numbers or negations."""
    if [w for w in a if any(c.isdigit() for c in w)] != [w for w in b if any(c.isdigit() for c in w)]:
        return False
    return sorted(w for w in a if w in _NEGATIONS) == sorted(w for w in b if w in _NEGATIONS)


def _fuzzy_contains(needle: str, haystack: str, threshold: float = 0.9) -> bool:
    """True if some word window of `haystack` about as long as `needle` has a difflib ratio >= threshold."""
    q_words = needle.split()
    t_words = haystack.split()
    n = len(q_words)
    if not n or not t_words:
        return False
    matcher = SequenceMatcher(None, autojunk=False)
    matcher.set_seq2(needle)
    anchors = set(sorted(set(q_words), key=len, reverse=True)[:3])
    starts: set[int] = set()
    for pos, word in enumerate(t_words):
        if word in anchors:
            starts.update(range(max(0, pos - n), pos + 1))
    if len(t_words) <= n + 1:
        starts.add(0)
    for start in sorted(starts):
        for size in (n, n - 1, n + 1):
            if size < 1 or start + size > len(t_words):
                continue
            window = t_words[start : start + size]
            matcher.set_seq1(" ".join(window))
            if matcher.real_quick_ratio() < threshold or matcher.quick_ratio() < threshold:
                continue
            if matcher.ratio() >= threshold and _same_meaning_markers(q_words, window):
                return True
    return False


def quote_in_text(quote: str, text: str) -> bool:
    """True if `quote` appears in `text` after normalization, allowing small differences.

    Normalization: Unicode NFKC, case-fold, curly quotes, dashes and ellipses straightened,
    whitespace collapsed, leading/trailing punctuation stripped. "[email]"/"[phone]" in the
    quote match the real address or number in the text. A close match (difflib ratio >= 0.9
    over a word window of the same length) is accepted too.
    """
    if not quote or not text:
        return False
    normalized = _normalize(quote)
    has_placeholder = bool(_PLACEHOLDER_RE.search(normalized))
    needle = normalized.strip(_EDGE_PUNCT_KEEP_BRACKETS if has_placeholder else _EDGE_PUNCT)
    if not needle:
        return False
    hay = _normalize(text)
    if needle in hay:
        return True
    if has_placeholder:
        hay = _normalize(mask_contacts(text))
        if needle in hay:
            return True
    needle_plain = _depunct(needle)
    if not needle_plain:
        return False
    hay_plain = _depunct(hay)
    if needle_plain in hay_plain:
        return True
    return _fuzzy_contains(needle_plain, hay_plain)


# ------------------------------------------------------------- text fragments


def _encode_directive(value: str) -> str:
    # quote() leaves "-" alone (it is unreserved) but text directives give it a meaning.
    return _percent_quote(value, safe="").replace("-", "%2D")


def text_fragment_url(url: str, quote: str) -> str:
    """`url` + "#:~:text=..." (URL Fragment Text Directives) that scrolls to and highlights `quote`.

    Quotes over 8 words use the textStart,textEnd form (first 4 and last 4 words). Quotes that
    contain "[email]"/"[phone]" placeholders link from the words before the first placeholder
    to the words after the last one, so the real address on the page sits inside the match.
    """
    base = (url or "").split("#", 1)[0]
    text = " ".join((quote or "").split())
    segments = [seg.strip() for seg in _PLACEHOLDER_RE.split(text)]
    segments = [seg for seg in segments if re.search(r"\w", seg)]
    if not segments:
        return base
    if len(segments) == 1:
        words = segments[0].split()
        if len(words) > 8:
            directive = _encode_directive(" ".join(words[:4])) + "," + _encode_directive(" ".join(words[-4:]))
        else:
            directive = _encode_directive(segments[0])
    else:
        first = segments[0].split()
        last = segments[-1].split()
        directive = _encode_directive(" ".join(first[:4])) + "," + _encode_directive(" ".join(last[-4:]))
    return f"{base}#:~:text={directive}"
