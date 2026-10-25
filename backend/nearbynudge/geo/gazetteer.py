"""Typed location -> coordinates from the free Census Gazetteer files (no geocoding API).

Files (one download each, about 1 MB zipped):
  https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{year}_Gazetteer/{year}_Gaz_place_national.zip
  https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{year}_Gazetteer/{year}_Gaz_zcta_national.zip

Places are incorporated cities, towns and villages plus Census Designated Places, each with an
internal point (INTPTLAT/INTPTLONG). ZCTAs are ZIP Code Tabulation Areas, also with an internal
point but no city names. The 2025 files are pipe-delimited and carry a GEOIDFQ column; 2024 and
earlier are tab-delimited with trailing spaces. Both layouts are read by column name.
"""

from __future__ import annotations

import bisect
import io
import logging
import math
import os
import re
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path

import httpx

from .states import STATE_NAMES, state_for_zip

log = logging.getLogger(__name__)

GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "{year}_Gazetteer/{year}_Gaz_{kind}_national.zip"
)
_KINDS = ("place", "zcta")
_REQUIRED_COLUMNS = {
    "place": ("USPS", "NAME", "INTPTLAT", "INTPTLONG"),
    "zcta": ("GEOID", "INTPTLAT", "INTPTLONG"),
}
_FILE_RE = re.compile(r"^(\d{4})_Gaz_(place|zcta)_national\.txt$")
_MAX_TXT_BYTES = 64 * 1024 * 1024  # the national files are about 3 MB; refuse anything absurd


class GazetteerMissing(Exception):
    """The Census Gazetteer files are not in data_dir/gazetteer (run Gazetteer.download first)."""


@dataclass(frozen=True)
class GeoResult:
    label: str  # "Arlington, VA" for cities; "ZIP 22201" for ZIPs (ZCTA files carry no city names)
    kind: str  # "zip" | "city"
    lat: float
    lon: float
    state: str  # USPS code; "" for a ZIP when no Census place is near its center
    note: str | None  # "Searching from the center of Arlington, VA"


# ---------------------------------------------------------------- text normalization

_ABBREVIATIONS = {"st": "saint", "ste": "sainte", "ft": "fort", "mt": "mount"}
_COUNTRY_KEYS = {"us", "usa", "united states", "united states of america", "america"}
_STREET_WORDS = frozenset(
    "st street ave av avenue rd road blvd boulevard dr drive ln lane way ct court pl place pkwy "
    "parkway hwy highway pike cir circle ter terrace trl trail sq square loop row aly alley plz plaza "
    "expy expressway fwy freeway tpke turnpike suite ste apt unit bldg floor fl n s e w ne nw se sw "
    "north south east west".split()
)


def _fold(text: str) -> str:
    """Lowercase ASCII: accents removed, '&' -> 'and', apostrophes dropped, other punctuation -> space."""
    s = unicodedata.normalize("NFKD", text)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower().replace("&", " and ")
    s = re.sub(r"['’‘`]", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s)


def _tokens(text: str, *, expand: bool = True) -> list[str]:
    """Words of `text`, with runs of single letters merged ("D.C." -> "dc") and, if `expand`,
    St./Ste./Ft./Mt. spelled out ("St. Louis" -> saint louis)."""
    out: list[str] = []
    prev_single = False
    for tok in _fold(text).split():
        single = len(tok) == 1 and tok.isalpha()
        if single and prev_single and out:
            out[-1] += tok
        else:
            out.append(tok)
        prev_single = single
    if expand:
        out = [_ABBREVIATIONS.get(t, t) for t in out]
    return out


def _key(text: str) -> str:
    return " ".join(_tokens(text))


_STATE_BY_KEY: dict[str, str] = {}
for _code, _name in STATE_NAMES.items():
    _STATE_BY_KEY[_code.lower()] = _code
    _STATE_BY_KEY[" ".join(_tokens(_name, expand=False))] = _code
_MAX_STATE_WORDS = max(len(k.split()) for k in _STATE_BY_KEY)


def _split_state(tokens: list[str]) -> tuple[str | None, list[str]]:
    """Find a trailing state code or name in unexpanded tokens: (USPS code, tokens before it)."""
    for n in range(min(_MAX_STATE_WORDS, len(tokens)), 0, -1):
        code = _STATE_BY_KEY.get(" ".join(tokens[-n:]))
        if code:
            return code, tokens[:-n]
    return None, tokens


# ---------------------------------------------------------------- Census place names

_SUFFIX_RE = re.compile(
    r"\s+(?:city and borough|consolidated government|metropolitan government|metro government|"
    r"unified government|urban county|zona urbana|comunidad|municipality|corporation|borough|"
    r"village|city|town|CDP)$"
)
_CONSOLIDATED_LSAD = {"00", "UC", "UG", "MG", "CG"}


def _place_names(name: str, lsad: str) -> list[tuple[str, int, bool]]:
    """(display name, priority, show in suggestions) for one Census place name.

    Priority 0 is the official name without its type suffix ("Arlington CDP" -> "Arlington").
    Priority 1 is a common short name ("Nashville-Davidson metropolitan government (balance)"
    -> "Nashville", "Urban Honolulu" -> "Honolulu", "San Buenaventura (Ventura)" -> "Ventura").
    Priority 2 drops a trailing " City" ("Boise City" -> "Boise"); used only to resolve.
    """
    base = name.strip()
    balance = base.endswith("(balance)")
    if balance:
        base = base[: -len("(balance)")].rstrip()
    base = _SUFFIX_RE.sub("", base).strip()
    out: list[tuple[str, int, bool]] = []
    paren = re.fullmatch(r"(.*?)\s*\(([^()]+)\)", base)
    if paren and paren.group(1).strip():
        base = paren.group(1).strip()
        out.append((base, 0, True))
        out.append((paren.group(2).strip(), 1, True))
    elif balance or lsad in _CONSOLIDATED_LSAD:
        short = re.split(r"\s*[-/,]\s*", base, maxsplit=1)[0].strip()
        if short and short != base:
            out.append((base, 0, False))
            out.append((short, 1, True))
        else:
            out.append((base, 0, True))
    elif base.startswith("Urban ") and len(base) > len("Urban "):
        out.append((base, 0, False))
        out.append((base[len("Urban ") :], 1, True))
    else:
        out.append((base, 0, True))
    if base.endswith(" City") and len(base.split()) >= 2:
        out.append((base[: -len(" City")], 2, False))
    return out


@dataclass(frozen=True, slots=True)
class _Place:
    state: str
    display: str
    funcstat: str
    aland: int
    lat: float
    lon: float

    @property
    def label(self) -> str:
        return f"{self.display}, {self.state}"


# New York City's boroughs are not Census places; internal points from the 2025 Census county
# Gazetteer (Bronx, Kings, New York, Queens and Richmond counties).
_EXTRA_PLACES: tuple[tuple[str, tuple[str, ...], float, float, int], ...] = (
    ("Manhattan", ("manhattan",), 40.776642, -73.970187, 58683879),
    ("Brooklyn", ("brooklyn",), 40.635045, -73.95064, 179684482),
    ("Queens", ("queens",), 40.654658, -73.841209, 281594050),
    ("Bronx", ("bronx", "the bronx"), 40.848711, -73.852939, 109301172),
    ("Staten Island", ("staten island",), 40.561263, -74.1399, 148982681),
)
# Inputs that name a city without a state but are unambiguous.
_NO_STATE_ALIASES = {"nyc": ("NY", "new york"), "new york city": ("NY", "new york")}
_STATE_ALIASES = {("NY", "nyc"): "new york", ("NY", "new york city"): "new york"}


def _choice_key(priority: int, place: _Place) -> tuple[int, int, int]:
    # Lowest priority number first, then active governments, then larger land area.
    return (priority, 0 if place.funcstat == "A" else 1, -place.aland)


# ---------------------------------------------------------------- file reading

def _read_table(path: Path, kind: str) -> tuple[dict[str, int], list[list[str]]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    if not lines:
        raise GazetteerMissing(f"{path} is empty; download the Gazetteer again")
    header = lines[0].lstrip("﻿")
    delim = "|" if "|" in header else "\t"
    columns = {name.strip().upper(): i for i, name in enumerate(header.split(delim))}
    missing = [c for c in _REQUIRED_COLUMNS[kind] if c not in columns]
    if missing:
        raise GazetteerMissing(f"{path} is missing columns {missing}; download the Gazetteer again")
    rows = [[f.strip() for f in line.split(delim)] for line in lines[1:] if line.strip()]
    return columns, rows


def _header_ok(path: Path, kind: str) -> bool:
    try:
        if not path.is_file() or path.stat().st_size < 200:
            return False
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            header = fh.readline().lstrip("﻿")
    except OSError:
        return False
    delim = "|" if "|" in header else "\t"
    names = {h.strip().upper() for h in header.split(delim)}
    return all(c in names for c in _REQUIRED_COLUMNS[kind])


def _newest_file(gdir: Path, kind: str) -> Path | None:
    best: tuple[int, Path] | None = None
    if not gdir.is_dir():
        return None
    for p in gdir.iterdir():
        m = _FILE_RE.match(p.name)
        if m and m.group(2) == kind and _header_ok(p, kind):
            year = int(m.group(1))
            if best is None or year > best[0]:
                best = (year, p)
    return best[1] if best else None


def _fetch_one(client: httpx.Client, kind: str, year: int, dest: Path) -> None:
    url = GAZETTEER_URL.format(year=year, kind=kind)
    resp = client.get(url)
    resp.raise_for_status()
    try:
        archive = zipfile.ZipFile(io.BytesIO(resp.content))
    except zipfile.BadZipFile as exc:
        raise RuntimeError(f"{url} is not a zip file") from exc
    wanted = f"{year}_Gaz_{kind}_national.txt"
    member = next((i for i in archive.infolist() if Path(i.filename).name == wanted), None)
    if member is None:
        raise RuntimeError(f"{url} does not contain {wanted}")
    if member.file_size > _MAX_TXT_BYTES:
        raise RuntimeError(f"{wanted} is unexpectedly large ({member.file_size} bytes)")
    data = archive.read(member)
    # Write next to the destination, then rename, so a half-written file never looks valid.
    fd, tmp = tempfile.mkstemp(prefix=f".{wanted}.", dir=dest.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        if not _header_ok(Path(tmp), kind):
            raise RuntimeError(f"{wanted} has an unexpected header")
        os.replace(tmp, dest)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


# ---------------------------------------------------------------- the gazetteer

_ZIP_RE = re.compile(r"(?<!\d)(\d{5})(?:-\d{4})?(?!\d)")


class Gazetteer:
    """In-memory Census places and ZCTAs. Read-only after loading, so safe to share across threads."""

    def __init__(self, place_table, zcta_table, *, source: str = "") -> None:
        self.source = source
        self._by_key: dict[tuple[str, str], list[tuple[int, _Place]]] = {}
        self._suggest: list[tuple[str, int]] = []  # (normalized name, entry index), sorted
        self._suggest_words: list[tuple[str, int]] = []  # (name from its 2nd+ word, entry index)
        self._entries: list[tuple[int, _Place, str]] = []  # (priority, place, normalized name)
        self._grid: dict[tuple[int, int], list[_Place]] = {}
        self._zcta: dict[str, tuple[float, float]] = {}

        cols, rows = place_table
        i_usps, i_name = cols["USPS"], cols["NAME"]
        i_lat, i_lon = cols["INTPTLAT"], cols["INTPTLONG"]
        i_lsad, i_func, i_aland = cols.get("LSAD"), cols.get("FUNCSTAT"), cols.get("ALAND")
        width = max(i_usps, i_name, i_lat, i_lon)
        for r in rows:
            if len(r) <= width:
                continue
            state = r[i_usps].upper()
            if state not in STATE_NAMES:
                continue
            try:
                lat, lon = float(r[i_lat]), float(r[i_lon])
            except ValueError:
                continue
            lsad = r[i_lsad] if i_lsad is not None and i_lsad < len(r) else ""
            func = r[i_func] if i_func is not None and i_func < len(r) else ""
            try:
                aland = int(r[i_aland]) if i_aland is not None and i_aland < len(r) else 0
            except ValueError:
                aland = 0
            for display, priority, show in _place_names(r[i_name], lsad):
                place = _Place(state, display, func, aland, lat, lon)
                self._add(place, priority, show, _key(display))
                if priority == 0:
                    self._grid.setdefault((math.floor(lat), math.floor(lon)), []).append(place)

        if any(state == "NY" for state, _ in self._by_key):
            for display, keys, lat, lon, aland in _EXTRA_PLACES:
                place = _Place("NY", display, "A", aland, lat, lon)
                for k in keys:
                    self._add(place, 0, k == keys[0], k)
        for (state, alias), target in _STATE_ALIASES.items():
            for priority, place in self._by_key.get((state, target), []):
                self._by_key.setdefault((state, alias), []).append((priority, place))

        self._suggest.sort()
        self._suggest_words.sort()

        cols, rows = zcta_table
        i_geoid, i_lat, i_lon = cols["GEOID"], cols["INTPTLAT"], cols["INTPTLONG"]
        width = max(i_geoid, i_lat, i_lon)
        for r in rows:
            if len(r) <= width or not re.fullmatch(r"\d{5}", r[i_geoid]):
                continue
            try:
                self._zcta[r[i_geoid]] = (float(r[i_lat]), float(r[i_lon]))
            except ValueError:
                continue
        self._zcta_codes = sorted(self._zcta)

    def _add(self, place: _Place, priority: int, show: bool, key: str) -> None:
        if not key:
            return
        self._by_key.setdefault((place.state, key), []).append((priority, place))
        if show:
            idx = len(self._entries)
            self._entries.append((priority, place, key))
            self._suggest.append((key, idx))
            words = key.split(" ")
            for i in range(1, len(words)):
                self._suggest_words.append((" ".join(words[i:]), idx))

    # ------------------------------------------------------------ loading

    @staticmethod
    def download(data_dir: Path, *, year: int = 2025) -> None:
        """Download and unzip the national place and ZCTA files into data_dir/gazetteer.

        Skips files that are already there. If the requested year fails, uses the year before
        (2024 for the default). Raises RuntimeError when neither year can be fetched.
        """
        gdir = Path(data_dir) / "gazetteer"
        gdir.mkdir(parents=True, exist_ok=True)
        needed = [k for k in _KINDS if not _header_ok(gdir / f"{year}_Gaz_{k}_national.txt", k)]
        if not needed:
            return
        timeout = httpx.Timeout(60.0, connect=15.0)
        headers = {"User-Agent": "NearbyNudge/2.0 (Census Gazetteer download)"}
        with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
            for kind in needed:
                errors: list[str] = []
                for y in (year, year - 1):
                    dest = gdir / f"{y}_Gaz_{kind}_national.txt"
                    try:
                        _fetch_one(client, kind, y, dest)
                        log.info("Downloaded Census Gazetteer %s", dest.name)
                        break
                    except Exception as exc:  # network, HTTP or archive problems: try the fallback
                        errors.append(f"{y}: {exc}")
                        if y != year and _header_ok(dest, kind):
                            break  # an earlier download of the fallback year is still usable
                else:
                    raise RuntimeError(
                        f"Could not download the Census Gazetteer {kind} file ({'; '.join(errors)})"
                    )

    @classmethod
    def open(cls, data_dir: Path) -> "Gazetteer":
        """Load the newest downloaded place and ZCTA files. Raises GazetteerMissing if absent."""
        gdir = Path(data_dir) / "gazetteer"
        place = _newest_file(gdir, "place")
        zcta = _newest_file(gdir, "zcta")
        if place is None or zcta is None:
            raise GazetteerMissing(
                f"Census Gazetteer files not found in {gdir}; run the Gazetteer download first"
            )
        return cls(
            _read_table(place, "place"),
            _read_table(zcta, "zcta"),
            source=f"US Census Gazetteer ({place.name}, {zcta.name})",
        )

    # ------------------------------------------------------------ resolve

    def resolve(self, text: str) -> GeoResult | None:
        """A typed address, ZIP or "City, ST" -> its point, or None when we can't tell."""
        raw = " ".join((text or "").split())
        if not raw:
            return None
        zips = self._zip_candidates(raw)
        for code in reversed(zips):  # the last ZIP in an address is the postal code
            point = self._zcta.get(code)
            if point:
                return self._zip_result(code, point)
        city = self._resolve_city(raw)
        if city:
            return city
        for code in reversed(zips):  # a ZIP with no map area (PO boxes): use its nearest neighbor
            near = self._nearby_zcta(code)
            if near:
                return near
        return None

    def _zip_candidates(self, text: str) -> list[str]:
        out: list[str] = []
        first_segment_end = text.find(",") if "," in text else len(text)
        for m in _ZIP_RE.finditer(text):
            if m.start() == 0 and m.end() < first_segment_end:
                # "12000 Government Center Pkwy, Fairfax, VA": a house number, not a ZIP
                words = _tokens(text[m.end() : first_segment_end], expand=False)
                if len(words) >= 2 and any(w in _STREET_WORDS for w in words):
                    continue
            out.append(m.group(1))
        return out

    def _resolve_city(self, text: str) -> GeoResult | None:
        text = _ZIP_RE.sub(" ", text)
        segments = [s for s in (part.strip() for part in text.split(",")) if _tokens(s, expand=False)]
        while segments and " ".join(_tokens(segments[-1], expand=False)) in _COUNTRY_KEYS:
            segments.pop()
        if not segments:
            return None
        last = _tokens(segments[-1], expand=False)
        while len(last) > 1 and last[-1] in ("us", "usa"):
            last = last[:-1]
        if len(last) > 2 and last[-2:] == ["united", "states"]:
            last = last[:-2]

        state, rest = _split_state(last)
        if state is None:
            alias = _NO_STATE_ALIASES.get(" ".join(_tokens(segments[-1])))
            if alias and len(segments) == 1:
                hit = self._best(*alias)
                return self._city_result(hit) if hit else None
            return None
        if state == "DC":  # the District is one city: "DC", "Washington, DC", any DC address
            hit = self._best("DC", "washington")
            return self._city_result(hit) if hit else None
        if rest:
            city = rest
        elif len(segments) >= 2:
            city = _tokens(segments[-2], expand=False)
        else:
            return None
        city = [_ABBREVIATIONS.get(t, t) for t in city]
        # Whole city part first, then shorter tails ("1200 N Highland St Arlington" -> "arlington").
        for start in range(len(city)):
            hit = self._best(state, " ".join(city[start:]))
            if hit:
                return self._city_result(hit)
        return None

    def _best(self, state: str, key: str) -> _Place | None:
        options = self._by_key.get((state, key))
        if not options:
            return None
        return min(options, key=lambda o: _choice_key(*o))[1]

    def _city_result(self, place: _Place) -> GeoResult:
        label = place.label
        return GeoResult(
            label=label,
            kind="city",
            lat=place.lat,
            lon=place.lon,
            state=place.state,
            note=f"Searching from the center of {label}",
        )

    def _zip_result(self, code: str, point: tuple[float, float], *, note: str | None = None) -> GeoResult:
        label = f"ZIP {code}"
        return GeoResult(
            label=label,
            kind="zip",
            lat=point[0],
            lon=point[1],
            state=state_for_zip(code) or self._nearest_state(*point),
            note=note or f"Searching from the center of {label}",
        )

    def _nearby_zcta(self, code: str) -> GeoResult | None:
        prefix = code[:3]
        lo = bisect.bisect_left(self._zcta_codes, prefix)
        hi = bisect.bisect_left(self._zcta_codes, prefix + ":")  # ':' sorts right after '9'
        same_area = self._zcta_codes[lo:hi]
        if not same_area:
            return None
        nearest = min(same_area, key=lambda c: (abs(int(c) - int(code)), c))
        note = f"ZIP {code} has no map area of its own; searching from the center of nearby ZIP {nearest}"
        return self._zip_result(code, self._zcta[nearest], note=note)

    def _nearest_state(self, lat: float, lon: float) -> str:
        """State of the Census place whose internal point is nearest (within about 70 miles)."""
        best_d, best_state = 1.0, ""
        cos_lat = math.cos(math.radians(lat))
        cy, cx = math.floor(lat), math.floor(lon)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for p in self._grid.get((cy + dy, cx + dx), ()):
                    d = (p.lat - lat) ** 2 + ((p.lon - lon) * cos_lat) ** 2
                    if d < best_d:
                        best_d, best_state = d, p.state
        return best_state

    # ------------------------------------------------------------ suggest

    def suggest(self, q: str, limit: int = 8) -> list[GeoResult]:
        """Typeahead: cities by name prefix ("City, ST", larger places first) or ZIPs by prefix."""
        q = " ".join((q or "").split())
        if limit <= 0 or not q:
            return []
        if re.fullmatch(r"\d{3,5}", q):
            lo = bisect.bisect_left(self._zcta_codes, q)
            out = []
            for code in self._zcta_codes[lo:]:
                if not code.startswith(q) or len(out) >= limit:
                    break
                out.append(self._zip_result(code, self._zcta[code]))
            return out
        if len(q.replace(" ", "")) < 2:
            return []

        city_part, states = self._suggest_states(q)
        raw = _tokens(city_part, expand=False)
        if not raw or states == set():
            return []
        expanded = [_ABBREVIATIONS.get(t, t) for t in raw]
        prefixes = {" ".join(expanded)}
        if raw[-1] in _ABBREVIATIONS and not re.search(r"[.\s]$", city_part):
            prefixes.add(" ".join(expanded[:-1] + raw[-1:]))  # "St" may still be "Sterling"

        best: dict[str, tuple[tuple, _Place]] = {}
        for prefix in prefixes:
            for source, word_rank in ((self._suggest, None), (self._suggest_words, 2)):
                i = bisect.bisect_left(source, (prefix, -1))
                while i < len(source) and source[i][0].startswith(prefix):
                    priority, place, key = self._entries[source[i][1]]
                    i += 1
                    if states is not None and place.state not in states:
                        continue
                    rank = word_rank if word_rank is not None else (0 if key == prefix else 1)
                    order = (rank,) + _choice_key(priority, place)
                    current = best.get(place.label)
                    if current is None or order < current[0]:
                        best[place.label] = (order, place)
        ranked = sorted(best.values(), key=lambda item: (item[0][0], -item[1].aland, item[1].label))
        return [self._city_result(place) for _, place in ranked[:limit]]

    def _suggest_states(self, q: str) -> tuple[str, set[str] | None]:
        """Split an optional state off a typeahead query: "Arlington, V" -> ("Arlington", {VA, VT})."""
        if "," in q:
            city, _, st = q.rpartition(",")
            st_key = " ".join(_tokens(st, expand=False))
            if not st_key:
                return city, None
            return city, {code for key, code in _STATE_BY_KEY.items() if key.startswith(st_key)}
        toks = _tokens(q, expand=False)
        if len(toks) >= 2:
            code, rest = _split_state(toks)
            if code and rest:
                return " ".join(rest), {code}
        return q, None
