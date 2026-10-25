"""Overture place categories: readable labels, and the categories NearbyNudge never prospects (LD2).

Overture keys are snake_case ("general_dentistry", "dental_clinic", "hvac_service"). Exclusion
works on whole tokens of category keys only (never business names), so "templeton" or a
business called "Gunther's" can't trigger it, while "christian_place_of_worship" or
"gun_and_ammo_store" do.
"""

from __future__ import annotations

import re
from functools import lru_cache

# ---------------------------------------------------------------- labels

_ACRONYMS = {
    "3d": "3D", "atm": "ATM", "atv": "ATV", "b2b": "B2B", "bbq": "BBQ", "cbd": "CBD", "cpa": "CPA",
    "cpr": "CPR", "csa": "CSA", "diy": "DIY", "dj": "DJ", "dmv": "DMV", "dui": "DUI", "dvd": "DVD",
    "ems": "EMS", "ev": "EV", "fmcg": "FMCG", "hvac": "HVAC", "ip": "IP", "it": "IT", "iv": "IV",
    "rv": "RV", "suv": "SUV", "tv": "TV", "ups": "UPS", "usps": "USPS", "vr": "VR", "ymca": "YMCA",
}
_WORDS = {
    "childrens": "children's", "womens": "women's", "mens": "men's", "jehovahs": "Jehovah's",
    "texmex": "Tex-Mex",
}
# Nationalities, cuisines, faiths and other proper nouns that keep a capital letter.
_PROPER = frozenset(
    """afghani african algerian american anglican apostolic arabian argentine armenian asian
    australian austrian azerbaijani bangladeshi baptist basque beijing belarusian belgian belizean
    bengali brazilian british buddhist bulgarian burmese cajun cambodian canadian cantonese
    caribbean catalan catholic chilean chinese christian christmas colombian creole croatian cuban
    czech danish dominican dutch ecuadorian egyptian episcopal eritrean ethiopian european filipino
    finnish french fujian georgian german greek guamanian guatemalan gujarati haitian hawaiian
    himalayan hindu honduran hunan hungarian hyderabadi iberian indian indonesian irish israeli
    italian jamaican japanese jewish jiangsu korean kurdish lankan laotian lebanese lithuanian
    lutheran malaysian maltese mediterranean methodist mexican micronesian mongolian montessori
    moroccan muslim nepalese nicaraguan nigerian norwegian orthodox pakistani palestinian panamanian
    paraguayan pentecostal persian peruvian polish polynesian portuguese protestant punjabi
    rajasthani rican roman romanian russian salvadoran scandinavian scottish senegalese serbo
    shandong shanghainese shinto sichuan sikh singaporean slovakian spanish sundanese surinamese
    swedish swiss syrian taiwanese tatar thai tibetan trinidadian turkish turkmen ukrainian
    uruguayan uzbek venezuelan vietnamese waldorf welsh xinjiang yemenite""".split()
)
# Words capitalized when they lead into a proper noun ("south_asian" -> "South Asian").
_LEAD_INS = frozenset(
    "north south east west southeast southwest northeast northwest central eastern western "
    "northern southern middle latin new costa puerto sri hong".split()
)
_PHRASES = {
    "middle eastern": "Middle Eastern", "hong kong": "Hong Kong", "new zealand": "New Zealand",
    "t shirt": "T-shirt", "jiu jitsu": "jiu-jitsu", "drive thru": "drive-thru",
    "jehovah's witness": "Jehovah's Witness", "latter day saints": "Latter Day Saints",
}


@lru_cache(maxsize=4096)
def label_for(key: str | None) -> str:
    """'general_dentistry' -> 'General dentistry', 'hvac_service' -> 'HVAC service'."""
    words = [w for w in re.split(r"[_\s]+", (key or "").strip().lower()) if w]
    if not words:
        return "Business"
    out: list[str] = []
    for i, w in enumerate(words):
        nxt = words[i + 1] if i + 1 < len(words) else ""
        if w in _ACRONYMS:
            out.append(_ACRONYMS[w])
        elif w in _WORDS:
            out.append(_WORDS[w])
        elif w in _PROPER or (w in _LEAD_INS and (nxt in _PROPER or nxt in _LEAD_INS)):
            out.append(w.capitalize())
        else:
            out.append(w)
    text = " ".join(out)
    for phrase, nice in _PHRASES.items():
        text = re.sub(rf"(?i)\b{phrase}\b", nice, text)
    return text[0].upper() + text[1:]


# ---------------------------------------------------------------- exclusions (LD2)

# Each pattern is a run of whole tokens that may appear anywhere in a category key or in any
# element of its hierarchy: "gun" matches gun_and_ammo_store, "place_of_worship" matches
# baptist_place_of_worship, "adult" matches adult_store and adult_entertainment_venue.
EXCLUDED_KEYWORDS: dict[str, tuple[str, ...]] = {
    "adult": (
        "adult", "adult_entertainment", "strip_club", "sex_shop", "erotic", "brothel",
        "escort_service",
    ),
    "cannabis": ("cannabis", "marijuana", "dispensary"),
    "firearms": (
        "gun", "guns", "gunsmith", "firearm", "firearms", "shooting_range", "ammunition", "ammo",
    ),
    "gambling": (
        "casino", "gambling", "betting", "bingo", "bingo_hall", "lottery", "horse_racing_track",
        "off_track_betting", "sweepstakes",
    ),
    "tobacco": (
        "tobacco", "vape", "vaping", "smoke_shop", "hookah", "cigar", "cigars", "cigarette",
        "e_cigarette",
    ),
    "payday loans": (
        "payday", "check_cashing", "title_loan", "title_loans", "pawn", "pawn_shop", "pawnshop",
        "cash_advance",
    ),
    "political": ("political", "campaign_office", "political_party_office"),
    "religious": (
        "religious", "place_of_worship", "church", "mosque", "synagogue", "temple", "cathedral",
        "monastery", "convent", "seminary", "ashram",
    ),
}
# Token runs that make a matching element an ordinary business after all: adult education and
# adult day care are not adult entertainment; religious goods and church supply shops are
# retailers, not religious groups.
EXCLUDED_EXCEPTIONS: dict[str, tuple[str, ...]] = {
    "adult": (
        "adult_education", "adult_day", "adult_daycare", "adult_care", "adult_school",
        "adult_learning", "adult_literacy", "adult_residential", "adult_foster", "adult_protective",
        "adult_living", "adult_home", "adult_health", "adult_medicine", "adult_sports",
        "adult_soccer", "adult_swim",
    ),
    "religious": ("goods_store", "supply_store"),
}


def _runs(patterns: tuple[str, ...]) -> tuple[tuple[str, ...], ...]:
    return tuple(tuple(t for t in re.split(r"[^a-z0-9]+", p.lower().rstrip("*_")) if t) for p in patterns)


_RULES = {group: _runs(p) for group, p in EXCLUDED_KEYWORDS.items()}
_EXCEPTIONS = {group: _runs(p) for group, p in EXCLUDED_EXCEPTIONS.items()}


def _has_run(tokens: tuple[str, ...], run: tuple[str, ...]) -> bool:
    n = len(run)
    return n > 0 and any(tokens[i : i + n] == run for i in range(len(tokens) - n + 1))


@lru_cache(maxsize=16384)
def excluded_group(element: str) -> str | None:
    """The exclusion group ("religious", "tobacco", ...) one category key falls in, or None."""
    tokens = tuple(t for t in re.split(r"[^a-z0-9]+", element.lower()) if t)
    if not tokens:
        return None
    for group, runs in _RULES.items():
        if any(_has_run(tokens, r) for r in runs):
            if any(_has_run(tokens, r) for r in _EXCEPTIONS.get(group, ())):
                continue
            return group
    return None


def is_excluded(category: str | None, hierarchy: list[str] | None = None) -> bool:
    """True if the category or any element of its hierarchy is in an excluded group."""
    if category and excluded_group(category):
        return True
    return any(excluded_group(h) for h in (hierarchy or ()) if h)


def rules_fingerprint() -> str:
    """Changes whenever the exclusion rules change, so stored flags can be recomputed."""
    import hashlib

    blob = repr((sorted(EXCLUDED_KEYWORDS.items()), sorted(EXCLUDED_EXCEPTIONS.items())))
    return hashlib.sha1(blob.encode()).hexdigest()[:16]
