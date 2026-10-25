"""Loading Overture places (track L). Offline: synthetic parquet files shaped like Overture's
place schema stand in for the S3 bucket. Tests marked `network` read the real bucket."""

from __future__ import annotations

import os
import zlib
from pathlib import Path

import duckdb
import httpx
import pytest

from nearbynudge.listings import FALLBACK_RELEASE, ListingsLoadError, ListingsStore, loader
from nearbynudge.listings import store as store_module

network = pytest.mark.skipif(os.environ.get("NN_NETWORK_TESTS") != "1", reason="set NN_NETWORK_TESTS=1")

ARLINGTON = (38.8816, -77.0910)
RICHMOND = (37.5407, -77.4360)
BOX_A = (-77.20, 38.80, -77.00, 38.95)  # around Arlington
BOX_B = (-77.55, 37.45, -77.35, 37.60)  # around Richmond

OVERTURE_DDL = """
    CREATE TABLE t (
        id VARCHAR,
        names STRUCT("primary" VARCHAR),
        basic_category VARCHAR,
        taxonomy STRUCT("primary" VARCHAR, hierarchy VARCHAR[], alternates VARCHAR[]),
        confidence DOUBLE,
        operating_status VARCHAR,
        websites VARCHAR[], emails VARCHAR[], phones VARCHAR[], socials VARCHAR[],
        addresses STRUCT(freeform VARCHAR, locality VARCHAR, postcode VARCHAR, region VARCHAR,
                         country VARCHAR)[],
        bbox STRUCT(xmin DOUBLE, xmax DOUBLE, ymin DOUBLE, ymax DOUBLE),
        brand STRUCT(wikidata VARCHAR, "names" STRUCT("primary" VARCHAR)),
        sources STRUCT(property VARCHAR, dataset VARCHAR, update_time VARCHAR)[]
    )
"""
DENTAL_TAXONOMY = {"primary": "general_dentistry", "alternates": None,
                   "hierarchy": ["health_care", "outpatient_care_facility", "dental_clinic", "general_dentistry"]}


def place(pid, name, lat, lon, *, status="open", confidence=0.9, websites=None, country="US",
          taxonomy=None, basic="dental_clinic", brand=None, sources=None, phones=None):
    return (
        pid,
        {"primary": name},
        basic,
        taxonomy or DENTAL_TAXONOMY,
        confidence,
        status,
        websites if websites is not None else [f"https://{pid}.example.com", ""],
        [f"hello@{pid}.example.com"],
        phones if phones is not None else [f"+1703555{zlib.crc32(pid.encode()) % 10000:04d}"],
        [f"https://www.facebook.com/{pid}"],
        [{"freeform": "1200 N Highland St", "locality": "Arlington", "postcode": "22201",
          "region": "VA", "country": country}],
        {"xmin": lon - 1e-5, "xmax": lon + 1e-5, "ymin": lat - 1e-5, "ymax": lat + 1e-5},
        brand,
        sources if sources is not None else [
            {"property": "", "dataset": "meta", "update_time": "2026-10-12T00:00:00.000Z"},
            {"property": "/properties/confidence", "dataset": "Overture", "update_time": "2026-10-15T18:00:21Z"},
        ],
    )


def write_parquet(path: Path, rows: list[tuple]) -> str:
    con = duckdb.connect()
    con.execute(OVERTURE_DDL)
    con.executemany("INSERT INTO t VALUES (" + ", ".join("?" * 14) + ")", rows)
    con.execute(f"COPY t TO '{path.as_posix()}' (FORMAT parquet)")  # test-owned temp path
    con.close()
    return str(path)


@pytest.fixture
def overture(tmp_path, monkeypatch):
    """Two releases of two place files (Arlington area and Richmond area), served offline."""
    lat, lon = ARLINGTON
    rlat, rlon = RICHMOND
    rel_old = {
        "a.parquet": [
            place("a1", "Smile Dental", lat, lon),
            place("a2", "Old Dental", lat + 0.01, lon),
            place("a3", "Branded", lat + 0.02, lon,
                  brand={"wikidata": "Q1", "names": {"primary": "Aspen Dental"}}),
            place("a4", "Signals First", lat + 0.03, lon, sources=[
                {"property": "/properties/confidence", "dataset": "Overture", "update_time": "2026-10-15T18:00:21Z"},
                {"property": "", "dataset": "Foursquare", "update_time": "2025-03-16T04:00:18.550Z"},
            ]),
            place("canada", "Maple Dental", lat, lon + 0.01, country="CA"),
            place("noname", "", lat, lon + 0.02),
            place("outside", "Far Dental", 39.5, -77.1),
        ],
        "b.parquet": [place("b1", "River Dental", rlat, rlon), place("b2", "James Dental", rlat + 0.01, rlon)],
    }
    rel_new = {
        "a.parquet": [
            place("a1", "Smile Dental Group", lat, lon, status="permanently_closed"),
            place("a5", "New Dental", lat + 0.04, lon),
        ],
        "b.parquet": [place("b1", "River Dental", rlat, rlon)],
    }
    files: dict[str, list[str]] = {}
    for release, content in (("2026-09-23.0", rel_old), ("2026-10-21.0", rel_new)):
        folder = tmp_path / release
        folder.mkdir()
        files[release] = [write_parquet(folder / name, rows) for name, rows in content.items()]

    state = {"releases": ["2026-09-23.0"], "listed": []}

    def list_releases():
        return sorted(state["releases"], reverse=True)

    def list_place_files(release):
        state["listed"].append(release)
        return files.get(release, [])

    monkeypatch.setattr(store_module, "_list_releases", list_releases)
    monkeypatch.setattr(store_module, "_list_place_files", list_place_files)
    monkeypatch.setattr(ListingsStore, "_prepare_remote", lambda self, cur: None)
    state["files"] = files
    return state


@pytest.fixture
def store(tmp_path):
    s = ListingsStore(tmp_path / "listings.duckdb")
    yield s
    s.close()


def test_load_bbox_maps_overture_fields(store, overture):
    messages: list[str] = []
    n = store.load_bbox("arlington", *BOX_A, progress=messages.append)
    assert n == 4  # a1-a4; not Canada, not the nameless place, not outside the box
    a1 = store.get("a1")
    assert a1.name == "Smile Dental"
    assert (a1.category, a1.basic_category) == ("general_dentistry", "dental_clinic")
    assert a1.hierarchy == DENTAL_TAXONOMY["hierarchy"]
    assert a1.category_label == "General dentistry"
    assert a1.websites == ["https://a1.example.com"]  # the empty string is dropped
    assert a1.emails == ["hello@a1.example.com"] and a1.socials == ["https://www.facebook.com/a1"]
    assert (a1.street, a1.locality, a1.region, a1.postcode, a1.country) == (
        "1200 N Highland St", "Arlington", "VA", "22201", "US")
    assert (a1.lat, a1.lon) == pytest.approx(ARLINGTON)
    assert (a1.source_dataset, a1.source_updated, a1.release) == ("meta", "2026-10-12", "2026-09-23.0")
    assert a1.confidence == 0.9 and a1.operating_status == "open"
    a3 = store.get("a3")
    assert (a3.brand, a3.brand_wikidata) == ("Aspen Dental", "Q1")
    a4 = store.get("a4")  # record source is the first source without a property
    assert (a4.source_dataset, a4.source_updated) == ("Foursquare", "2025-03-16")
    assert store.get("canada") is None and store.get("noname") is None and store.get("outside") is None
    assert any("Downloading" in m for m in messages) and messages[-1].startswith("Loaded 4 places")
    stats = store.stats()
    assert stats["rows"] == 4 and stats["release"] == "2026-09-23.0"
    assert stats["areas"][0]["name"] == "arlington" and stats["areas"][0]["rows"] == 4
    found = store.find_candidates(*ARLINGTON, 5, ["dental_clinic"])
    assert [r.place_id for r in found] == ["a1", "a2", "a4"]  # a3 is a Wikidata brand


def test_covers_after_load(store, overture):
    assert not store.covers(*ARLINGTON, 3)
    store.load_bbox("arlington", *BOX_A)
    assert store.covers(*ARLINGTON, 3)
    assert not store.covers(*ARLINGTON, 10)
    assert not store.covers(*RICHMOND, 1)


def test_reload_with_new_release_updates_and_drops_stale_rows(store, overture):
    store.load_bbox("arlington", *BOX_A)
    store.load_bbox("richmond", *BOX_B)
    overture["releases"].append("2026-10-21.0")
    n = store.load_bbox("arlington", *BOX_A)
    assert n == 2
    assert store.get("a1").name == "Smile Dental Group"
    assert store.get("a1").release == "2026-10-21.0"
    assert store.get("a1").operating_status == "permanently_closed"
    assert store.get("a5") is not None
    assert store.get("a2") is None and store.get("a4") is None  # gone from the new release
    assert store.get("b2") is not None  # other areas keep their rows
    assert [r.place_id for r in store.find_candidates(*ARLINGTON, 5, ["dental_clinic"])] == ["a5"]
    assert {a["name"]: a["release"] for a in store.stats()["areas"]} == {
        "arlington": "2026-10-21.0", "richmond": "2026-09-23.0"}
    assert store.stats()["release"] == "2026-10-21.0"


def test_file_index_is_cached_and_prunes_files(store, overture):
    store.load_bbox("arlington", *BOX_A)
    assert overture["listed"] == ["2026-09-23.0"]
    with store._cursor() as cur:
        assert cur.execute("SELECT count(DISTINCT file) FROM overture_row_groups").fetchone()[0] == 2
    os.remove(overture["files"]["2026-09-23.0"][1])  # the Richmond file
    assert store.load_bbox("arlington", *BOX_A) == 4  # never opens the Richmond file
    assert overture["listed"] == ["2026-09-23.0"]  # the index came from the store
    with pytest.raises(ListingsLoadError):
        store.load_bbox("richmond", *BOX_B)


def test_box_with_no_places_is_recorded(store, overture):
    assert store.load_bbox("ocean", -70.0, 30.0, -69.0, 31.0) == 0
    assert store.covers(30.5, -69.5, 5)


def test_newest_release_without_place_files_falls_back(store, overture):
    overture["releases"].append("2026-11-18.0")  # announced, no place files
    assert store.load_bbox("arlington", *BOX_A) == 4
    assert store.get("a1").release == "2026-09-23.0"


def test_release_listing_failure_uses_fallback_release(store, overture, monkeypatch):
    monkeypatch.setattr(store_module, "_list_releases", lambda: [])
    assert store.load_bbox("arlington", *BOX_A) == 2  # the fixture's newer release is the fallback
    assert overture["listed"] == [FALLBACK_RELEASE]
    assert store.get("a5").release == FALLBACK_RELEASE


def test_release_without_any_place_files_raises(store, overture, monkeypatch):
    monkeypatch.setattr(store_module, "_list_releases", lambda: ["2026-11-18.0"])
    with pytest.raises(ListingsLoadError, match="no place files"):
        store.load_bbox("arlington", *BOX_A)


def test_broken_progress_callback_does_not_stop_a_load(store, overture):
    def boom(_message):
        raise RuntimeError("UI went away")

    assert store.load_bbox("arlington", *BOX_A, progress=boom) == 4


def test_invalid_bbox(store, overture):
    with pytest.raises(ValueError):
        store.load_bbox("bad", -77.0, 38.8, -77.2, 38.9)


def test_load_area_loads_once_with_margin(store, overture):
    messages: list[str] = []
    n = store.load_area(*ARLINGTON, 3, margin_mi=2, progress=messages.append)
    assert n == 4
    area = store.stats()["areas"][0]
    assert area["name"].startswith("near 38.8816,-77.0910")
    assert area["ymax"] - ARLINGTON[0] == pytest.approx(5 / 69.09, rel=0.01)  # radius + margin
    assert store.covers(*ARLINGTON, 3) and store.covers(*ARLINGTON, 5)
    listed = list(overture["listed"])
    assert store.load_area(*ARLINGTON, 3, progress=messages.append) == 0  # already covered
    assert overture["listed"] == listed
    assert messages[-1] == "Business listings for this area are already loaded"


def test_load_metro(store, monkeypatch):
    calls = []
    monkeypatch.setattr(ListingsStore, "load_bbox", lambda self, name, *box, progress=None: calls.append((name, box)) or 7)
    assert loader.load_metro(store, "dc") == 7
    assert calls == [("dc", (-77.40, 38.70, -76.85, 39.10))]
    with pytest.raises(KeyError):
        loader.load_metro(store, "atlantis")


def test_metros_are_well_formed():
    assert loader.METROS["dc"]["label"].startswith("Washington, DC metro")
    assert len(loader.METROS) >= 5
    for key, metro in loader.METROS.items():
        xmin, ymin, xmax, ymax = metro["bbox"]
        assert -125 < xmin < xmax < -66 and 24 < ymin < ymax < 50, key  # contiguous US
        assert (xmax - xmin) * (ymax - ymin) < 1.0, key  # metro-sized
        assert metro["label"]


# ---------------------------------------------------------------- releases and the bucket listing


def test_latest_release_picks_newest(monkeypatch):
    prefixes = ["release/2026-09-23.0/", "release/2026-09-23.1/", "release/2026-10-21.0/", "release/junk/"]
    monkeypatch.setattr(store_module, "_s3_list", lambda params, **kw: (prefixes, []))
    assert ListingsStore.latest_release() == "2026-10-21.0"
    prefixes.append("release/2026-10-21.1/")
    assert ListingsStore.latest_release() == "2026-10-21.1"


def test_latest_release_falls_back_on_errors(monkeypatch):
    def fail(params, **kw):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(store_module, "_s3_list", fail)
    assert ListingsStore.latest_release() == FALLBACK_RELEASE


def test_s3_listing_follows_pagination(monkeypatch):
    pages = {
        None: ("<ListBucketResult><IsTruncated>true</IsTruncated>"
               "<Contents><Key>release/r/theme=places/type=place/part-0.parquet</Key><Size>10</Size></Contents>"
               "<NextContinuationToken>tok&amp;1</NextContinuationToken></ListBucketResult>"),
        "tok&1": ("<ListBucketResult><IsTruncated>false</IsTruncated>"
                  "<Contents><Key>release/r/theme=places/type=place/part-1.parquet</Key><Size>0</Size></Contents>"
                  "<Contents><Key>release/r/theme=places/type=place/part-2.parquet</Key><Size>20</Size></Contents>"
                  "</ListBucketResult>"),
    }
    seen = []
    real_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        token = request.url.params.get("continuation-token")
        seen.append(dict(request.url.params))
        return httpx.Response(200, text=pages[token])

    monkeypatch.setattr(store_module.httpx, "Client",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    files = store_module._list_place_files("r")
    assert files == [  # empty objects are skipped
        "s3://overturemaps-us-west-2/release/r/theme=places/type=place/part-0.parquet",
        "s3://overturemaps-us-west-2/release/r/theme=places/type=place/part-2.parquet",
    ]
    assert seen[0]["list-type"] == "2" and seen[0]["prefix"] == "release/r/theme=places/type=place/"
    assert seen[1]["continuation-token"] == "tok&1"


# ---------------------------------------------------------------- the real bucket


@pytest.mark.network
@network
def test_real_latest_release():
    release = ListingsStore.latest_release()
    assert release != "" and release[:4].isdigit() and "." in release


@pytest.mark.network
@network
def test_real_load_of_a_small_box(tmp_path):
    with ListingsStore(tmp_path / "l.duckdb") as s:
        n = s.load_bbox("ballston", -77.115, 38.875, -77.105, 38.885)
        assert n > 50
        assert s.category_counts(38.88, -77.11, 0.3)
        assert s.stats()["release"] == ListingsStore.latest_release()
