"""Listings store (track L): LD2 matching on synthetic rows in a temporary DuckDB file. Offline."""

from __future__ import annotations

import itertools
import math
import threading
import time

import duckdb
import pytest

from nearbynudge.listings import FALLBACK_RELEASE, Listing, ListingsStore
from nearbynudge.listings.categories import label_for
from nearbynudge.listings.keys import MILES_PER_DEGREE_LAT

LAT, LON = 38.8816, -77.0910  # Arlington, VA
DENTAL = ["health_care", "outpatient_care_facility", "dental_clinic"]
DENTIST_KEYS = ["dental_clinic", "general_dentistry", "cosmetic_dentistry", "pediatric_dentistry"]
_ids = itertools.count(1)


def at(north_mi: float = 0.0, east_mi: float = 0.0) -> tuple[float, float]:
    lat = LAT + north_mi / MILES_PER_DEGREE_LAT
    lon = LON + east_mi / (MILES_PER_DEGREE_LAT * math.cos(math.radians(LAT)))
    return lat, lon


def make(
    pid: str,
    name: str | None = None,
    *,
    north: float = 0.0,
    east: float = 0.0,
    category: str | None = "general_dentistry",
    basic: str | None = "dental_clinic",
    hierarchy: list[str] | None = None,
    confidence: float | None = 0.9,
    status: str | None = "open",
    websites: list[str] | None = None,
    phones: list[str] | None = None,
    emails: list[str] | None = None,
    brand: str | None = None,
    brand_wikidata: str | None = None,
    release: str = "2026-10-21.0",
) -> Listing:
    n = next(_ids)
    lat, lon = at(north, east)
    if hierarchy is None:
        hierarchy = DENTAL + ([category] if category and category not in DENTAL else [])
    return Listing(
        place_id=pid,
        name=name or f"Practice {pid}",
        category=category,
        basic_category=basic,
        category_label=label_for(category or basic),
        hierarchy=hierarchy,
        confidence=confidence,
        operating_status=status,
        websites=[f"https://www.{pid}-dental.com/"] if websites is None else websites,
        emails=[] if emails is None else emails,
        phones=[f"+1703555{n:04d}"] if phones is None else phones,
        socials=[],
        street=f"{n} Wilson Blvd",
        locality="Arlington",
        region="VA",
        postcode="22201",
        country="US",
        lat=lat,
        lon=lon,
        brand=brand,
        brand_wikidata=brand_wikidata,
        chain_count=1,
        source_dataset="meta",
        source_updated="2026-10-12",
        release=release,
    )


@pytest.fixture
def store(tmp_path):
    s = ListingsStore(tmp_path / "listings.duckdb")
    yield s
    s.close()


def ids(results) -> list[str]:
    return [r.place_id for r in results]


def find(store, radius=5.0, cats=None, **kw):
    return store.find_candidates(LAT, LON, radius, cats or DENTIST_KEYS, **kw)


# ---------------------------------------------------------------- basics


def test_insert_and_get_round_trip(store):
    row = make("a", "Smile Dental LLC", north=1, websites=["https://smile.com", " ", ""],
               emails=["hi@smile.com"], brand="Smile", confidence=0.87)
    store.insert_listings([row])
    got = store.get("a")
    assert got is not None
    assert got.name == "Smile Dental LLC"
    assert got.websites == ["https://smile.com"]  # empty strings dropped
    assert got.emails == ["hi@smile.com"]
    assert got.hierarchy == DENTAL + ["general_dentistry"]
    assert got.category_label == "General dentistry"
    assert got.chain_count == 1
    assert got.distance_mi is None
    assert (got.lat, got.lon) == pytest.approx((row.lat, row.lon))
    assert (got.source_dataset, got.source_updated, got.release) == ("meta", "2026-10-12", "2026-10-21.0")
    assert got.website == "https://smile.com"
    assert got.address == f"{row.street}, Arlington, VA 22201"
    assert got.to_dict()["place_id"] == "a"


def test_get_unknown_is_none(store):
    assert store.get("nope") is None


def test_insert_upserts_by_place_id(store):
    store.insert_listings([make("a", "Old Name")])
    store.insert_listings([make("a", "New Name")])
    assert store.stats()["rows"] == 1
    assert store.get("a").name == "New Name"


def test_insert_last_duplicate_in_batch_wins(store):
    store.insert_listings([make("a", "First"), make("a", "Second")])
    assert store.get("a").name == "Second"


def test_works_in_memory():
    s = ListingsStore(":memory:")
    try:
        s.insert_listings([make("a")])
        assert ids(find(s)) == ["a"]
    finally:
        s.close()


# ---------------------------------------------------------------- distance


def test_radius_filter_and_rounded_distance(store):
    store.insert_listings([
        make("near", north=0.52), make("edge", north=2.94), make("out", north=3.1),
        make("far", north=10), make("east", east=2.9), make("east_out", east=3.1),
    ])
    found = find(store, radius=3)
    assert set(ids(found)) == {"near", "edge", "east"}
    dist = {r.place_id: r.distance_mi for r in found}
    assert dist == {"near": 0.5, "edge": 2.9, "east": 2.9}


def test_zero_radius_or_no_categories_find_nothing(store):
    store.insert_listings([make("a")])
    assert find(store, radius=0) == []
    assert store.find_candidates(LAT, LON, 5, []) == []
    assert store.find_candidates(LAT, LON, 5, ["", "  "]) == []
    assert find(store, limit=0) == []


# ---------------------------------------------------------------- categories


def test_category_matches_primary_basic_or_hierarchy(store):
    store.insert_listings([
        make("gen", category="general_dentistry"),
        make("ortho", category="orthodontics"),
        make("hvac", category="hvac_service", basic="home_service",
             hierarchy=["services_and_business", "home_service", "hvac_service"]),
        make("food", category=None, basic="food_service", hierarchy=[]),
    ])
    assert ids(find(store, cats=["general_dentistry"])) == ["gen"]
    assert ids(find(store, cats=["orthodontics"])) == ["ortho"]
    assert set(ids(find(store, cats=["dental_clinic"]))) == {"gen", "ortho"}  # basic category
    assert set(ids(find(store, cats=["outpatient_care_facility"]))) == {"gen", "ortho"}  # hierarchy
    assert ids(find(store, cats=["home_service"])) == ["hvac"]
    assert ids(find(store, cats=["food_service"])) == ["food"]  # basic only, no taxonomy
    assert find(store, cats=["dental"]) == []  # whole keys only, never substrings


def test_category_keys_are_normalized_and_never_injected(store):
    store.insert_listings([make("gen")])
    assert ids(find(store, cats=["General Dentistry"])) == ["gen"]
    assert ids(find(store, cats=["general-dentistry"])) == ["gen"]
    assert find(store, cats=["general_dentistry)|(.*"]) == []
    assert find(store, cats=["x'; DROP TABLE places; --"]) == []
    assert store.stats()["rows"] == 1


# ---------------------------------------------------------------- LD2 drops


def test_drops_closed_listings(store):
    store.insert_listings([
        make("open", status="open"), make("unknown", status=None),
        make("closed", status="closed"), make("temp", status="temporarily_closed"),
        make("gone", status="permanently_closed"),
    ])
    assert set(ids(find(store))) == {"open", "unknown"}


def test_drops_low_confidence(store):
    store.insert_listings([
        make("ok", confidence=0.6), make("low", confidence=0.59),
        make("null_site", confidence=None), make("null_nosite", confidence=None, websites=[]),
    ])
    assert set(ids(find(store))) == {"ok", "null_site"}


@pytest.mark.parametrize(
    "category, basic, hierarchy",
    [
        ("christian_place_of_worship", "christian_place_of_worship",
         ["cultural_and_historic", "place_of_worship", "christian_place_of_worship"]),
        ("religious_organization", "religious_organization", ["cultural_and_historic", "religious_organization"]),
        ("tobacco_shop", "food_and_beverage_store", ["shopping", "food_and_beverage_store", "tobacco_shop"]),
        ("cannabis_dispensary", "specialty_store",
         ["shopping", "specialty_store", "smoke_and_vape_store", "cannabis_dispensary"]),
        ("adult_entertainment_venue", "adult_entertainment_venue",
         ["arts_and_entertainment", "nightlife_venue", "adult_entertainment_venue"]),
        ("gun_and_ammo_store", "specialty_store", ["shopping", "specialty_store", "gun_and_ammo_store"]),
        ("casino", "casino", ["arts_and_entertainment", "gaming_venue", "casino"]),
        ("check_cashing_payday_loans", "financial_service",
         ["services_and_business", "financial_service", "check_cashing_payday_loans"]),
        ("political_party_office", "political_organization",
         ["community_and_government", "civic_organization", "political_organization", "political_party_office"]),
        (None, "christian_place_of_worship", []),  # basic category only
    ],
)
def test_drops_excluded_categories(store, category, basic, hierarchy):
    store.insert_listings([make("x", category=category, basic=basic, hierarchy=hierarchy)])
    search = [k for k in (category, basic) if k]
    assert find(store, cats=search) == []
    assert all(k != (category or basic) for k, _, _ in store.category_counts(LAT, LON, 5))


def test_keeps_lookalikes_of_excluded_categories(store):
    store.insert_listings([
        make("school", category="adult_education_center", basic="place_of_learning",
             hierarchy=["education", "place_of_learning", "adult_education_center"]),
        make("arcade", category="arcade", basic="gaming_venue",
             hierarchy=["arts_and_entertainment", "gaming_venue", "arcade"]),
        make("shop", category="church_supply_store", basic="specialty_store",
             hierarchy=["shopping", "specialty_store", "religious_and_spiritual_goods_store",
                        "christian_goods_store", "church_supply_store"]),
        make("templeton", "Templeton Gunther Dental"),  # names never matter
    ])
    found = find(store, cats=["adult_education_center", "arcade", "church_supply_store", "general_dentistry"])
    assert set(ids(found)) == {"school", "arcade", "shop", "templeton"}


def test_drops_chains_by_name(store):
    chain = ["Bright Smiles", "Bright Smiles LLC", "BRIGHT SMILES - Ballston", "Bright Smiles, Inc.",
             "The Bright Smiles"]
    store.insert_listings(
        [make(f"c{i}", name, north=i * 1.5) for i, name in enumerate(chain)]  # some outside 5 mi
        + [make(f"f{i}", "Family Dental", north=i * 0.5) for i in range(4)]
    )
    assert store.get("c0").chain_count == 5
    assert store.get("f0").chain_count == 4
    assert set(ids(find(store, radius=25))) == {"f0", "f1", "f2", "f3"}


def test_drops_chains_by_brand_or_wikidata(store):
    store.insert_listings(
        [make(f"b{i}", f"Office {i}", north=i, brand="Aspen Dental") for i in range(5)]
        + [make("wd", "Kool Smiles Arlington", brand="Kool Smiles", brand_wikidata="Q123")]
        + [make("small", "Ballston Smiles", brand="Ballston Smiles")]
    )
    assert store.get("b0").chain_count == 5
    assert ids(find(store, radius=25)) == ["small"]


def test_chain_count_updates_as_data_grows(store):
    store.insert_listings([make(f"s{i}", "Sunrise Dental", north=i) for i in range(4)])
    assert ids(find(store, radius=25)) != []
    store.insert_listings([make("s4", "Sunrise Dental", north=20)])  # outside the search
    assert store.get("s0").chain_count == 5
    assert find(store, radius=25) == []


# ---------------------------------------------------------------- exclusion lists


def test_exclude_place_ids_and_their_duplicates(store):
    store.insert_listings([
        make("drafted", websites=["https://smile.com"], confidence=0.95),
        make("dup", websites=["http://www.smile.com/contact"], confidence=0.7, north=0.3),
        make("other"),
    ])
    assert ids(find(store, exclude_place_ids={"drafted"})) == ["other"]
    assert set(ids(find(store, exclude_place_ids=frozenset()))) == {"drafted", "other"}


def test_exclude_domains(store):
    store.insert_listings([
        make("smile", websites=["https://www.Smile.com/arlington"]),
        make("sub", websites=["https://arlington.brightdental.com"]),
        make("bright", websites=["https://brightdental.com"]),
        make("page_a", websites=["https://linktr.ee/dr_a"]),
        make("page_b", websites=["https://linktr.ee/dr_b"]),
        make("plain"),
    ])
    assert "smile" not in ids(find(store, exclude_domains={"smile.com"}))
    assert "smile" not in ids(find(store, exclude_domains={"WWW.SMILE.COM"}))
    assert "smile" not in ids(find(store, exclude_domains={"https://smile.com/"}))
    # A registrable domain blocks its subdomains; a subdomain blocks only itself.
    assert {"sub", "bright"}.isdisjoint(ids(find(store, exclude_domains={"brightdental.com"})))
    got = set(ids(find(store, exclude_domains={"arlington.brightdental.com"})))
    assert "sub" not in got and "bright" in got
    # Shared platforms: only the named page is blocked, never the whole platform.
    assert {"page_a", "page_b"} <= set(ids(find(store, exclude_domains={"linktr.ee"})))
    got = set(ids(find(store, exclude_domains={"linktr.ee/dr_a"})))
    assert "page_a" not in got and "page_b" in got
    assert len(find(store, exclude_domains={"smile.com", "brightdental.com"})) == 3


# ---------------------------------------------------------------- dedupe


def test_dedupe_same_website_keeps_highest_confidence(store):
    store.insert_listings([
        make("lo", websites=["http://smile.com"], confidence=0.7),
        make("hi", websites=["https://www.smile.com/about"], confidence=0.95, north=2),
        make("mid", websites=["https://SMILE.com"], confidence=0.8),
    ])
    assert ids(find(store)) == ["hi"]


def test_dedupe_same_phone_keeps_highest_confidence(store):
    store.insert_listings([
        make("lo", phones=["(703) 555-0199"], confidence=0.7),
        make("hi", phones=["+1 703 555 0199"], confidence=0.9, north=1),
        make("short", phones=["555-0199"], confidence=0.8),  # fewer than 10 digits: no match
    ])
    assert set(ids(find(store))) == {"hi", "short"}


def test_dedupe_same_name_within_150_m(store):
    store.insert_listings([
        make("a", "Smile Dental", confidence=0.9),
        make("b", "Smile Dental, LLC", confidence=0.8, north=0.05),  # 80 m away
        make("c", "SMILE DENTAL", confidence=0.95, north=0.3),  # 480 m away: another office
    ])
    assert set(ids(find(store))) == {"a", "c"}


def test_dedupe_runs_website_then_phone_then_name(store):
    # "b" shares a website with "a" (better) and a phone with "c" (worse): once "b" is gone as a
    # website duplicate, "c" is no longer anyone's phone duplicate.
    store.insert_listings([
        make("a", websites=["https://one.com"], phones=["7035550001"], confidence=0.9),
        make("b", websites=["https://one.com"], phones=["7035550002"], confidence=0.8),
        make("c", websites=["https://two.com"], phones=["7035550002"], confidence=0.7),
    ])
    assert set(ids(find(store))) == {"a", "c"}


def test_dedupe_never_merges_different_platform_pages(store):
    store.insert_listings([
        make("fb_a", websites=["https://www.facebook.com/smileA"]),
        make("fb_b", websites=["https://facebook.com/smileB/"]),
        make("fb_root1", websites=["https://www.facebook.com/"]),
        make("fb_root2", websites=["https://www.facebook.com"]),
        make("wix_a", websites=["https://drsmith.wixsite.com/dental"]),
        make("wix_b", websites=["https://drjones.wixsite.com/dental"]),
        make("loc_a", websites=["https://arlington.smilegroup.com"]),
        make("loc_b", websites=["https://bethesda.smilegroup.com"]),
    ])
    assert len(find(store)) == 8


def test_duplicates_of_a_drafted_business_stay_out(store):
    store.insert_listings([
        make("drafted", "Ballston Dental", phones=["7035550111"], websites=["https://a.com"]),
        make("phone_dup", "Ballston Dental Arts", phones=["703-555-0111"], websites=["https://b.com"]),
        make("name_dup", "Ballston Dental", north=0.02, phones=["7035550999"], websites=[]),
    ])
    assert find(store, exclude_place_ids={"drafted"}) == []


# ---------------------------------------------------------------- order and limit


def test_sorted_by_website_then_confidence_then_distance(store):
    store.insert_listings([
        make("nosite_hi", confidence=0.99, websites=[]),
        make("site_far", confidence=0.95, north=4),
        make("site_near", confidence=0.951, north=1),  # same confidence to two decimals
        make("site_top", confidence=0.99, north=3),
        make("site_low", confidence=0.7, north=0.1),
    ])
    assert ids(find(store)) == ["site_top", "site_near", "site_far", "site_low", "nosite_hi"]


def test_limit(store):
    store.insert_listings([make(f"p{i}", north=i * 0.1) for i in range(30)])
    found = find(store, limit=7)
    assert len(found) == 7
    assert ids(found) == ids(find(store))[:7]


# ---------------------------------------------------------------- category counts


def test_category_counts(store):
    store.insert_listings(
        [make(f"g{i}", category="general_dentistry", north=i * 0.2) for i in range(3)]
        + [make(f"o{i}", category="orthodontics", north=i * 0.2) for i in range(2)]
        + [make("closed", category="orthodontics", status="permanently_closed")]
        + [make("far", category="orthodontics", north=30)]
        + [make("food", category=None, basic="food_service", hierarchy=[])]
        + [make("church", category="christian_place_of_worship", basic="christian_place_of_worship",
                hierarchy=["cultural_and_historic", "place_of_worship", "christian_place_of_worship"])]
        + [make("low", category="hvac_service", basic="home_service", confidence=0.1,
                hierarchy=["services_and_business", "home_service", "hvac_service"])]
    )
    counts = store.category_counts(LAT, LON, 5)
    assert counts == [
        ("general_dentistry", "General dentistry", 3),
        ("orthodontics", "Orthodontics", 2),
        ("food_service", "Food service", 1),
        ("hvac_service", "HVAC service", 1),  # counts don't apply the confidence rule
    ]
    assert store.category_counts(LAT, LON, 0) == []


def test_all_categories(store):
    store.insert_listings(
        [make(f"g{i}", category="general_dentistry", north=i * 3) for i in range(3)]
        + [make("o", category="orthodontics", north=50)]
    )
    assert store.all_categories() == [("general_dentistry", "General dentistry", 3),
                                      ("orthodontics", "Orthodontics", 1)]
    assert store.all_categories(limit=1) == [("general_dentistry", "General dentistry", 3)]


# ---------------------------------------------------------------- areas and stats


def test_stats_without_areas(store):
    assert store.stats() == {"rows": 0, "areas": [], "release": None}
    store.insert_listings([make("a"), make("b", release="2026-09-23.0")])
    assert store.stats() == {"rows": 2, "areas": [], "release": "2026-10-21.0"}


def test_register_area_makes_covers_true(store):
    store.insert_listings([make("a")])
    assert not store.covers(LAT, LON, 5)
    store.register_area("test", LON - 0.2, LAT - 0.2, LON + 0.2, LAT + 0.2, rows=1)
    assert store.covers(LAT, LON, 5)
    assert store.covers(LAT, LON, 0)
    assert not store.covers(LAT, LON, 20)  # circle bigger than the box
    assert not store.covers(LAT + 1, LON, 1)
    area = store.stats()["areas"][0]
    assert area["name"] == "test" and area["rows"] == 1
    assert area["release"] == "2026-10-21.0"  # newest release among stored places
    assert area["loaded_at"].endswith("Z")
    assert (area["xmin"], area["ymin"], area["xmax"], area["ymax"]) == pytest.approx(
        (LON - 0.2, LAT - 0.2, LON + 0.2, LAT + 0.2))
    assert store.stats()["release"] == "2026-10-21.0"


def test_register_area_replaces_same_name_and_validates(store):
    store.register_area("x", -77.2, 38.8, -77.0, 39.0, release="2026-09-23.0")
    store.register_area("x", -77.3, 38.7, -76.9, 39.1, release="2026-10-21.0", rows=5)
    areas = store.stats()["areas"]
    assert len(areas) == 1 and areas[0]["xmin"] == -77.3 and areas[0]["rows"] == 5
    with pytest.raises(ValueError):
        store.register_area("bad", -77.0, 38.8, -77.2, 39.0)
    empty = ListingsStore(":memory:")
    try:
        empty.register_area("e", -77.2, 38.8, -77.0, 39.0)
        assert empty.stats()["areas"][0]["release"] == FALLBACK_RELEASE
    finally:
        empty.close()


def test_covers_needs_one_area_containing_the_whole_circle(store):
    store.register_area("west", LON - 0.3, LAT - 0.3, LON, LAT + 0.3)
    store.register_area("east", LON, LAT - 0.3, LON + 0.3, LAT + 0.3)
    assert store.covers(LAT, LON - 0.1, 2)
    assert not store.covers(LAT, LON, 2)  # straddles the two boxes


# ---------------------------------------------------------------- persistence


def test_reopen_keeps_data(tmp_path):
    path = tmp_path / "l.duckdb"
    with ListingsStore(path) as s:
        s.insert_listings([make("a"), make("b", websites=["https://b-practice.com"])])
        s.register_area("t", LON - 1, LAT - 1, LON + 1, LAT + 1)
    with ListingsStore(path) as s:
        assert s.stats()["rows"] == 2
        assert s.covers(LAT, LON, 5)
        assert set(ids(find(s))) == {"a", "b"}


def test_reopen_recomputes_derived_columns_when_rules_change(tmp_path):
    path = tmp_path / "l.duckdb"
    with ListingsStore(path) as s:
        s.insert_listings([
            make("a", websites=["https://same.com"], confidence=0.9),
            make("b", websites=["https://same.com"], confidence=0.8),
        ])
    con = duckdb.connect(str(path))  # simulate a store written by older rules
    con.execute("UPDATE places SET excluded = true")
    con.execute("UPDATE places SET site_keys = NULL, web_keys = NULL, phone_keys = NULL")
    con.execute("UPDATE store_meta SET value = 'old' WHERE key IN ('excluded_rules', 'keys_version')")
    con.close()
    with ListingsStore(path) as s:
        assert ids(find(s)) == ["a"]  # flags recomputed, and b is again a duplicate of a


def test_closed_store_refuses_calls(tmp_path):
    s = ListingsStore(tmp_path / "l.duckdb")
    s.close()
    s.close()  # idempotent
    with pytest.raises(RuntimeError):
        s.stats()


# ---------------------------------------------------------------- concurrency and speed


def test_concurrent_reads_and_writes(store):
    store.insert_listings([make(f"p{i}", north=i * 0.05) for i in range(50)])
    errors: list[BaseException] = []

    def reader():
        try:
            for _ in range(15):
                assert len(find(store)) >= 50
                store.category_counts(LAT, LON, 5)
                store.covers(LAT, LON, 5)
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    def writer(k):
        try:
            for j in range(5):
                store.insert_listings([make(f"w{k}_{j}", north=1 + j * 0.1)])
        except BaseException as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=reader) for _ in range(4)] + [
        threading.Thread(target=writer, args=(k,)) for k in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert store.stats()["rows"] == 60


def _fill_metro(store: ListingsStore, n: int) -> None:
    """n synthetic places spread over the DC metro box, inserted with SQL for speed."""
    with store._cursor() as cur:
        cur.execute("SELECT setseed(0.42)")
        cur.execute(
            """
            INSERT INTO places (place_id, name, name_norm, category, basic_category, hierarchy,
                confidence, operating_status, websites, emails, phones, socials, street, locality,
                region, postcode, country, lat, lon, brand, brand_wikidata, brand_norm, chain_count,
                excluded, source_dataset, source_updated, release, loaded_at, site_keys, web_keys,
                phone_keys, cat_path)
            SELECT 'p' || i, 'Business ' || i, 'business ' || i, cat, basic,
                   ['root', basic, cat], 0.5 + (i % 50) / 100.0,
                   CASE WHEN i % 13 = 0 THEN 'permanently_closed' ELSE 'open' END,
                   CASE WHEN i % 4 = 0 THEN []::VARCHAR[] ELSE ['https://site' || (i % 90000) || '.com'] END,
                   []::VARCHAR[], ['+1703' || lpad(((i * 7919) % 9000000)::VARCHAR, 7, '0')], []::VARCHAR[],
                   i || ' Main St', 'Arlington', 'VA', '22201', 'US', lat, lon, NULL, NULL, NULL, 1, false,
                   'meta', '2026-10-12', '2026-10-21.0', now()::TIMESTAMP,
                   CASE WHEN i % 4 = 0 THEN []::VARCHAR[] ELSE ['site' || (i % 90000) || '.com'] END,
                   CASE WHEN i % 4 = 0 THEN []::VARCHAR[] ELSE ['site' || (i % 90000) || '.com'] END,
                   ['703' || lpad(((i * 7919) % 9000000)::VARCHAR, 7, '0')],
                   '>' || cat || '>' || basic || '>root>' || basic || '>' || cat || '>'
            FROM (
                SELECT i, 38.70 + random() * 0.40 AS lat, -77.40 + random() * 0.55 AS lon,
                       ['general_dentistry', 'restaurant', 'hvac_service', 'hair_salon', 'law_firm',
                        'real_estate_agent', 'plumbing', 'yoga_studio'][1 + i % 8] AS cat,
                       ['dental_clinic', 'eat_and_drink', 'home_service', 'beauty_service', 'legal_service',
                        'real_estate', 'home_service', 'fitness'][1 + i % 8] AS basic
                FROM range(?) r(i)
            )
            ORDER BY lat, lon
            """,
            [n],
        )


def test_find_candidates_is_fast_on_a_metro_sized_store(store):
    _fill_metro(store, 200_000)
    # A 5-mile specific search, a 25-mile restaurant search and a 25-mile search over a broad
    # parent category (a quarter of the metro, ~40,000 eligible places).
    queries = [(5, ["dental_clinic"]), (25, ["eat_and_drink"]), (25, ["home_service"])]
    for radius, cats in queries:
        best = math.inf
        for _ in range(3):
            started = time.perf_counter()
            found = store.find_candidates(LAT, LON, radius, cats)
            best = min(best, time.perf_counter() - started)
        assert len(found) == 200
        assert best < 0.3, f"{cats} within {radius} mi took {best * 1000:.0f} ms"
