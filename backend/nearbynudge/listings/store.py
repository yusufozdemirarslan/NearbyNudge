"""DuckDB store of Overture Maps places, searched by category and distance (PRD LD1, LD2).

Places come from the public Overture bucket (s3://overturemaps-us-west-2, anonymous). Every row
keeps the release it came from and its own source dataset and update date. A load reads only
the files whose row groups overlap the requested box; the row-group index of a release is read
once and cached in the store.

Thread safety: every call uses its own DuckDB cursor; writes are serialized by a lock, and loads
by a second lock so two requests for the same new area download it once.
"""

from __future__ import annotations

import html
import logging
import re
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import httpx

from . import sql
from .categories import is_excluded, label_for, rules_fingerprint
from .keys import KEYS_VERSION, METERS_PER_MILE, bbox_around, exclusion_keys, place_keys

log = logging.getLogger(__name__)

FALLBACK_RELEASE = "2026-10-21.0"
OVERTURE_BUCKET = "overturemaps-us-west-2"
OVERTURE_LIST_URL = f"https://{OVERTURE_BUCKET}.s3.us-west-2.amazonaws.com/"

# LD2 thresholds (the closed statuses themselves live in sql._OPEN).
MIN_CONFIDENCE = 0.6
CHAIN_MIN_COUNT = 5  # places sharing a name or brand in the loaded data: a proxy for 10+ nationwide
DUPLICATE_DISTANCE_M = 150.0

Progress = Callable[[str], None]


class ListingsLoadError(RuntimeError):
    """Overture Maps could not be read (network trouble, missing release or unexpected files)."""


@dataclass
class Listing:
    place_id: str
    name: str
    category: str | None
    basic_category: str | None
    category_label: str
    hierarchy: list[str]
    confidence: float | None
    operating_status: str | None
    websites: list[str]
    emails: list[str]
    phones: list[str]
    socials: list[str]
    street: str | None
    locality: str | None
    region: str | None
    postcode: str | None
    country: str | None
    lat: float
    lon: float
    brand: str | None
    brand_wikidata: str | None
    chain_count: int  # loaded places sharing this normalized name (or brand)
    source_dataset: str | None  # e.g. "meta", "Microsoft", "Foursquare", "BrightQuery"
    source_updated: str | None  # ISO date of the source's update time
    release: str  # Overture release, e.g. "2026-10-21.0"
    distance_mi: float | None = None

    @property
    def website(self) -> str | None:
        return self.websites[0] if self.websites else None

    @property
    def phone(self) -> str | None:
        return self.phones[0] if self.phones else None

    @property
    def address(self) -> str:
        """'1200 N Highland St, Arlington, VA 22201'."""
        region = " ".join(p for p in (self.region, self.postcode) if p)
        return ", ".join(p for p in (self.street, self.locality, region) if p)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------- Overture bucket listing

_RELEASE_RE = re.compile(r"^release/(\d{4}-\d{2}-\d{2}\.\d+)/$")


def _release_sort_key(release: str) -> tuple[str, int]:
    date, _, n = release.partition(".")
    return (date, int(n) if n.isdigit() else -1)


def _s3_list(params: dict[str, str], *, timeout: float = 15.0) -> tuple[list[str], list[tuple[str, int]]]:
    """Anonymous ListObjectsV2 on the Overture bucket: (common prefixes, [(key, size)])."""
    prefixes: list[str] = []
    objects: list[tuple[str, int]] = []
    token: str | None = None
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        for _ in range(100):
            query = {"list-type": "2", **params}
            if token:
                query["continuation-token"] = token
            resp = client.get(OVERTURE_LIST_URL, params=query)
            resp.raise_for_status()
            body = resp.text
            prefixes += [html.unescape(p) for p in re.findall(r"<CommonPrefixes><Prefix>(.*?)</Prefix>", body)]
            for block in re.findall(r"<Contents>(.*?)</Contents>", body, flags=re.S):
                key = re.search(r"<Key>(.*?)</Key>", block)
                size = re.search(r"<Size>(\d+)</Size>", block)
                if key:
                    objects.append((html.unescape(key.group(1)), int(size.group(1)) if size else 0))
            nxt = re.search(r"<NextContinuationToken>(.*?)</NextContinuationToken>", body)
            if "<IsTruncated>true</IsTruncated>" not in body or not nxt:
                break
            token = html.unescape(nxt.group(1))
    return prefixes, objects


def _list_releases() -> list[str]:
    """Overture releases, newest first; [] if the bucket listing can't be read."""
    try:
        prefixes, _ = _s3_list({"prefix": "release/", "delimiter": "/"})
    except Exception as exc:  # network trouble: callers fall back to a known release
        log.warning("Could not list Overture releases: %s", exc)
        return []
    found = {m.group(1) for p in prefixes if (m := _RELEASE_RE.match(p))}
    return sorted(found, key=_release_sort_key, reverse=True)


def _list_place_files(release: str) -> list[str]:
    """s3:// URLs of a release's place files ([] if the release has none)."""
    prefix = f"release/{release}/theme=places/type=place/"
    try:
        _, objects = _s3_list({"prefix": prefix})
    except Exception as exc:
        raise ListingsLoadError(f"Could not list Overture place files for {release}: {exc}") from exc
    return sorted(
        f"s3://{OVERTURE_BUCKET}/{key}" for key, size in objects if key.endswith(".parquet") and size > 0
    )


# ---------------------------------------------------------------- helpers

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(ts: datetime | None) -> str | None:
    if ts is None:
        return None
    return ts.replace(microsecond=0).isoformat() + "Z"


def _category_key(category: str | None, basic: str | None, hierarchy: Iterable[str] | None) -> str:
    """Python twin of the nn_category_key SQL macro."""
    return "|".join((category or "", basic or "", ">".join(hierarchy or ())))


def _safe(progress: Progress | None) -> Progress:
    def say(message: str) -> None:
        log.info("listings: %s", message)
        if progress is not None:
            try:
                progress(message)
            except Exception:  # a broken status callback must not break the load
                log.exception("listings progress callback failed")

    return say


def _clean(values: Iterable[str] | None) -> list[str]:
    return [v.strip() for v in (values or ()) if isinstance(v, str) and v.strip()]


_COL = {name: i for i, name in enumerate(sql.LISTING_COLUMNS)}


def _listing(row: tuple, distance_mi: float | None = None) -> Listing:
    c = _COL
    category, basic = row[c["category"]], row[c["basic_category"]]
    return Listing(
        place_id=row[c["place_id"]],
        name=row[c["name"]],
        category=category,
        basic_category=basic,
        category_label=label_for(category or basic),
        hierarchy=list(row[c["hierarchy"]] or []),
        confidence=row[c["confidence"]],
        operating_status=row[c["operating_status"]],
        websites=list(row[c["websites"]] or []),
        emails=list(row[c["emails"]] or []),
        phones=list(row[c["phones"]] or []),
        socials=list(row[c["socials"]] or []),
        street=row[c["street"]],
        locality=row[c["locality"]],
        region=row[c["region"]],
        postcode=row[c["postcode"]],
        country=row[c["country"]],
        lat=row[c["lat"]],
        lon=row[c["lon"]],
        brand=row[c["brand"]],
        brand_wikidata=row[c["brand_wikidata"]],
        chain_count=int(row[c["chain_count"]] or 0),
        source_dataset=row[c["source_dataset"]],
        source_updated=row[c["source_updated"]],
        release=row[c["release"]],
        distance_mi=None if distance_mi is None else round(distance_mi, 1),
    )


_CATEGORY_KEY_RE = re.compile(r"^[a-z0-9_]+$")


def _category_key_param(value: str | None) -> str | None:
    """An Overture category key as find_candidates matches it ('Dental clinic' -> 'dental_clinic');
    None for anything that can't be a key."""
    key = re.sub(r"[\s\-]+", "_", (value or "").strip().lower())
    return key if _CATEGORY_KEY_RE.match(key) else None


# ---------------------------------------------------------------- the store


class ListingsStore:
    """Overture places in a DuckDB file, with LD2 matching."""

    def __init__(self, path: Path):
        self.path = Path(path)
        target = str(path)
        if target != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._con = duckdb.connect(target)
        self._cursor_lock = threading.Lock()
        self._write_lock = threading.RLock()
        self._load_lock = threading.RLock()
        self._closed = False
        with self._write_lock, self._cursor() as cur:
            for statement in sql.SCHEMA:
                cur.execute(statement)
            self._set_meta(cur, "schema_version", sql.SCHEMA_VERSION)
            # Derived columns follow the code: recompute them when the rules have changed.
            fingerprint = rules_fingerprint()
            if self._get_meta(cur, "excluded_rules") != fingerprint:
                cur.execute(sql.RESET_EXCLUDED)
                self._refresh_excluded(cur)
                self._set_meta(cur, "excluded_rules", fingerprint)
            if self._get_meta(cur, "keys_version") != KEYS_VERSION:
                cur.execute(sql.RESET_KEYS)
                self._set_meta(cur, "keys_version", KEYS_VERSION)
            self._refresh_keys(cur)  # also fills rows from before the key columns existed

    # ------------------------------------------------------------ plumbing

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._con.close()
        except duckdb.Error:
            pass

    def __enter__(self) -> "ListingsStore":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    @contextmanager
    def _cursor(self) -> Iterator[duckdb.DuckDBPyConnection]:
        if self._closed:
            raise RuntimeError("ListingsStore is closed")
        with self._cursor_lock:
            cur = self._con.cursor()
        try:
            yield cur
        finally:
            cur.close()

    @staticmethod
    @contextmanager
    def _transaction(cur: duckdb.DuckDBPyConnection) -> Iterator[None]:
        cur.execute(sql.BEGIN)
        try:
            yield
        except BaseException:
            cur.execute(sql.ROLLBACK)
            raise
        cur.execute(sql.COMMIT)

    @staticmethod
    def _get_meta(cur, key: str) -> str | None:
        row = cur.execute(sql.GET_META, [key]).fetchone()
        return row[0] if row else None

    @staticmethod
    def _set_meta(cur, key: str, value: str) -> None:
        cur.execute(sql.DELETE_META, [key])
        cur.execute(sql.INSERT_META, [key, value])

    # ------------------------------------------------------------ loading

    @staticmethod
    def latest_release() -> str:
        """Newest Overture release in the public bucket, or FALLBACK_RELEASE on any error."""
        releases = _list_releases()
        return releases[0] if releases else FALLBACK_RELEASE

    def covers(self, lat: float, lon: float, radius_mi: float) -> bool:
        """True if one loaded area's box contains the whole search circle's box."""
        xmin, ymin, xmax, ymax = bbox_around(lat, lon, max(float(radius_mi), 0.0))
        with self._cursor() as cur:
            return cur.execute(sql.COVERS, [xmin, ymin, xmax, ymax]).fetchone()[0] > 0

    def load_area(
        self,
        lat: float,
        lon: float,
        radius_mi: float,
        *,
        margin_mi: float = 5,
        progress: Progress | None = None,
    ) -> int:
        """Make sure the circle is loaded: loads its box plus `margin_mi` unless an area already
        covers it (then returns 0). Concurrent calls for the same place download it once."""
        with self._load_lock:
            if self.covers(lat, lon, radius_mi):
                _safe(progress)("Business listings for this area are already loaded")
                return 0
            reach = float(radius_mi) + max(float(margin_mi), 0.0)
            xmin, ymin, xmax, ymax = bbox_around(lat, lon, reach)
            name = f"near {lat:.4f},{lon:.4f} ({reach:g} mi)"
            return self.load_bbox(name, xmin, ymin, xmax, ymax, progress=progress)

    def load_bbox(
        self,
        name: str,
        xmin: float,
        ymin: float,
        xmax: float,
        ymax: float,
        *,
        progress: Progress | None = None,
    ) -> int:
        """Download the places in a box from the latest Overture release (upsert by place_id),
        drop rows of older releases the new one no longer has, record the area and recompute
        chain counts. Returns the number of places written."""
        say = _safe(progress)
        xmin, ymin, xmax, ymax = (float(v) for v in (xmin, ymin, xmax, ymax))
        if not (-180.0 <= xmin < xmax <= 180.0 and -90.0 <= ymin < ymax <= 90.0):
            raise ValueError(f"Invalid bounding box {(xmin, ymin, xmax, ymax)}")
        started = time.monotonic()
        with self._load_lock, self._cursor() as cur:
            say("Checking the latest Overture Maps release")
            releases = _list_releases()[:2] or [FALLBACK_RELEASE]
            self._prepare_remote(cur)
            files: list[str] | None = None
            release = releases[0]
            for release in releases:  # the newest release, or the one before if it has no places
                files = self._files_for_box(cur, release, xmin, ymin, xmax, ymax, say)
                if files is not None:
                    break
            if files is None:
                raise ListingsLoadError(f"Overture release {releases[0]} has no place files")
            if files:
                say(f"Downloading business listings from Overture Maps ({release})")
                try:
                    cur.execute(sql.STAGE_FROM_OVERTURE, [files, xmin, xmax, ymin, ymax, release])
                except duckdb.Error as exc:
                    raise ListingsLoadError(f"Could not read Overture Maps places: {exc}") from exc
            else:
                cur.execute(sql.CREATE_EMPTY_STAGING)
            rows = int(cur.execute(sql.COUNT_STAGING).fetchone()[0])
            say(f"Saving {rows:,} places")
            self._stage_keys(cur, sql.STAGED_CONTACTS)
            with self._write_lock, self._transaction(cur):
                cur.execute(sql.DELETE_STALE_IN_BOX, [ymin, ymax, xmin, xmax, release])
                self._merge_staging(cur)
                cur.execute(sql.DELETE_AREA, [name])
                cur.execute(sql.INSERT_AREA, [name, xmin, ymin, xmax, ymax, release, _utcnow(), rows])
                self._refresh_derived(cur)
            cur.execute(sql.DROP_STAGING)
            cur.execute(sql.DROP_KEYS)
            self._checkpoint(cur)
        say(f"Loaded {rows:,} places in {time.monotonic() - started:.0f} s")
        return rows

    def register_area(
        self,
        name: str,
        xmin: float,
        ymin: float,
        xmax: float,
        ymax: float,
        *,
        release: str | None = None,
        rows: int = 0,
    ) -> None:
        """Record an area as loaded without downloading anything (tests and seeding: call
        insert_listings, then register_area, and covers() is True inside the box). Replaces an
        area of the same name. `release` defaults to the newest release among stored places."""
        xmin, ymin, xmax, ymax = (float(v) for v in (xmin, ymin, xmax, ymax))
        if not (-180.0 <= xmin < xmax <= 180.0 and -90.0 <= ymin < ymax <= 90.0):
            raise ValueError(f"Invalid bounding box {(xmin, ymin, xmax, ymax)}")
        with self._write_lock, self._cursor() as cur:
            if release is None:
                release = cur.execute(sql.NEWEST_PLACE_RELEASE).fetchone()[0] or FALLBACK_RELEASE
            with self._transaction(cur):
                cur.execute(sql.DELETE_AREA, [name])
                cur.execute(
                    sql.INSERT_AREA, [name, xmin, ymin, xmax, ymax, release, _utcnow(), int(rows)]
                )

    def _prepare_remote(self, cur) -> None:
        try:
            cur.execute(sql.LOAD_HTTPFS)
        except duckdb.Error:
            try:
                cur.execute(sql.INSTALL_HTTPFS)
                cur.execute(sql.LOAD_HTTPFS)
            except duckdb.Error as exc:
                raise ListingsLoadError(f"DuckDB's httpfs extension is unavailable: {exc}") from exc
        for statement in sql.REMOTE_SETTINGS:
            cur.execute(statement)

    def _files_for_box(self, cur, release, xmin, ymin, xmax, ymax, say) -> list[str] | None:
        """Place files of `release` with row groups overlapping the box; None if it has none."""
        if not cur.execute(sql.COUNT_ROW_GROUPS, [release]).fetchone()[0]:
            files = _list_place_files(release)
            if not files:
                return None
            say("Reading the Overture Maps file index (once per release)")
            try:
                cur.execute(sql.STAGE_ROW_GROUPS, [release, files])
            except duckdb.Error as exc:
                raise ListingsLoadError(f"Could not read Overture Maps file index: {exc}") from exc
            if not cur.execute(sql.COUNT_STAGED_ROW_GROUPS).fetchone()[0]:
                cur.execute(sql.DROP_ROW_GROUPS)
                return files  # no usable statistics: let DuckDB scan every file
            with self._write_lock, self._transaction(cur):
                cur.execute(sql.DELETE_ROW_GROUPS, [release])
                cur.execute(sql.SAVE_ROW_GROUPS)
            cur.execute(sql.DROP_ROW_GROUPS)
        rows = cur.execute(sql.FILES_FOR_BOX, [release, xmax, xmin, ymax, ymin]).fetchall()
        return [r[0] for r in rows]

    def insert_listings(self, rows: list[Listing]) -> None:
        """Upsert listings directly (tests and seeding); recomputes chain counts."""
        if not rows:
            return
        latest = {r.place_id: r for r in rows}
        params = [
            (
                r.place_id, r.name, r.category, r.basic_category, _clean(r.hierarchy),
                r.confidence, r.operating_status, _clean(r.websites), _clean(r.emails),
                _clean(r.phones), _clean(r.socials), r.street, r.locality, r.region, r.postcode,
                r.country, float(r.lat), float(r.lon), r.brand, r.brand_wikidata,
                r.source_dataset, r.source_updated, r.release,
            )
            for r in latest.values()
        ]
        with self._write_lock, self._cursor() as cur:
            cur.execute(sql.CREATE_EMPTY_STAGING)
            cur.executemany(sql.INSERT_STAGING_ROW, params)
            self._stage_keys(cur, sql.STAGED_CONTACTS)
            with self._transaction(cur):
                self._merge_staging(cur)
                self._refresh_derived(cur)
            cur.execute(sql.DROP_STAGING)
            cur.execute(sql.DROP_KEYS)

    def _merge_staging(self, cur) -> None:
        """Upsert _staging (with its _keys) into places."""
        cur.execute(sql.DELETE_STAGED_PLACES)
        cur.execute(sql.INSERT_FROM_STAGING, [_utcnow()])

    @staticmethod
    def _stage_keys(cur, select_contacts: str) -> int:
        """Compute match keys for (place_id, websites, phones) rows into the _keys temp table."""
        ids: list[str] = []
        sites: list[list[str]] = []
        webs: list[list[str]] = []
        tels: list[list[str]] = []
        for place_id, websites, phones in cur.execute(select_contacts).fetchall():
            s, w, t = place_keys(websites, phones)
            ids.append(place_id)
            sites.append(s)
            webs.append(w)
            tels.append(t)
        cur.execute(sql.CREATE_KEYS, [ids, sites, webs, tels])
        return len(ids)

    def _refresh_keys(self, cur) -> None:
        """Fill match keys of places that have none (after an upgrade or a rules change)."""
        if self._stage_keys(cur, sql.UNKEYED_CONTACTS):
            with self._transaction(cur):
                cur.execute(sql.APPLY_KEYS)
        cur.execute(sql.DROP_KEYS)

    def _refresh_derived(self, cur) -> None:
        cur.execute(sql.COMPUTE_CHAIN_COUNTS)
        cur.execute(sql.APPLY_CHAIN_COUNTS)
        cur.execute(sql.DROP_CHAIN)
        self._refresh_excluded(cur)

    def _refresh_excluded(self, cur) -> None:
        flagged = []
        for category, basic, hierarchy in cur.execute(sql.PENDING_CATEGORY_KEYS).fetchall():
            elements = list(hierarchy or []) + ([basic] if basic else [])
            if is_excluded(category or basic, elements):
                flagged.append(_category_key(category, basic, hierarchy))
        cur.execute(sql.APPLY_EXCLUDED, [flagged])

    @staticmethod
    def _checkpoint(cur) -> None:
        try:
            cur.execute(sql.CHECKPOINT)
        except duckdb.Error as exc:  # another transaction is open; DuckDB checkpoints later
            log.debug("checkpoint skipped: %s", exc)

    # ------------------------------------------------------------ search

    def category_counts(self, lat: float, lon: float, radius_mi: float) -> list[tuple[str, str, int]]:
        """(category key, label, count) of open, non-excluded places within the radius."""
        if radius_mi <= 0:
            return []
        with self._cursor() as cur:
            rows = cur.execute(sql.CATEGORY_COUNTS, self._circle(lat, lon, radius_mi)).fetchall()
        return [(key, label_for(key), int(n)) for key, n in rows]

    def all_categories(self, limit: int = 3000) -> list[tuple[str, str, int]]:
        """(category key, label, count) of open, non-excluded places across the whole store."""
        if limit <= 0:
            return []
        with self._cursor() as cur:
            rows = cur.execute(sql.ALL_CATEGORIES, [int(limit)]).fetchall()
        return [(key, label_for(key), int(n)) for key, n in rows]

    def get(self, place_id: str) -> Listing | None:
        with self._cursor() as cur:
            row = cur.execute(sql.GET_PLACE, [place_id]).fetchone()
        return _listing(row) if row else None

    @staticmethod
    def _circle(lat: float, lon: float, radius_mi: float) -> dict:
        # The box prefilter is padded slightly; the haversine test is exact.
        xmin, ymin, xmax, ymax = bbox_around(lat, lon, float(radius_mi) * 1.01 + 0.01)
        return {
            "lat": float(lat), "lon": float(lon), "radius": float(radius_mi),
            "xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax,
        }

    def find_candidates(
        self,
        lat: float,
        lon: float,
        radius_mi: float,
        categories: list[str],
        *,
        exclude_place_ids: frozenset[str] | set[str] = frozenset(),
        exclude_domains: frozenset[str] | set[str] = frozenset(),
        limit: int = 200,
    ) -> list[Listing]:
        """Matching businesses after every LD2 rule, best first: has a website, then
        confidence (to two decimals), then distance. Places in `exclude_place_ids` or on an
        `exclude_domains` site are dropped, and so are their duplicates."""
        keys = sorted({k for c in categories or () if (k := _category_key_param(c))})
        if not keys or radius_mi <= 0 or limit <= 0:
            return []
        blocked: set[str] = set()
        for entry in exclude_domains or ():
            blocked |= exclusion_keys(entry)
        params = self._circle(lat, lon, radius_mi) | {
            "pattern": ">(" + "|".join(keys) + ")>",
            "min_confidence": MIN_CONFIDENCE,
            "chain_min": CHAIN_MIN_COUNT,
            "skip_ids": sorted({str(p) for p in exclude_place_ids or ()}),
            "blocked": sorted(blocked),
            "dup_mi": DUPLICATE_DISTANCE_M / METERS_PER_MILE,
            "limit": int(limit),
        }
        with self._cursor() as cur:
            rows = cur.execute(sql.FIND_CANDIDATES, params).fetchall()
        return [_listing(row[:-1], row[-1]) for row in rows]

    # ------------------------------------------------------------ status

    def stats(self) -> dict:
        with self._cursor() as cur:
            rows = int(cur.execute(sql.COUNT_PLACES).fetchone()[0])
            areas = [
                {
                    "name": name, "xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1,
                    "release": release, "loaded_at": _iso(loaded_at), "rows": int(count),
                }
                for name, x0, y0, x1, y1, release, loaded_at, count in cur.execute(sql.LIST_AREAS).fetchall()
            ]
            release = max((a["release"] for a in areas), key=_release_sort_key, default=None)
            if release is None and rows:
                release = cur.execute(sql.NEWEST_PLACE_RELEASE).fetchone()[0]
        return {"rows": rows, "areas": areas, "release": release}
