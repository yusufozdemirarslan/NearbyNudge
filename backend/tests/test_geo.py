"""Census Gazetteer lookups (track L, geo). Offline: small fixture files in the real formats."""

from __future__ import annotations

import dataclasses
import io
import os
import shutil
import zipfile
from pathlib import Path

import httpx
import pytest

from nearbynudge.geo import Gazetteer, GazetteerMissing, GeoResult
from nearbynudge.geo import gazetteer as gazetteer_module
from nearbynudge.geo.states import state_for_zip

FIXTURES = Path(__file__).parent / "fixtures" / "geo"
network = pytest.mark.skipif(os.environ.get("NN_NETWORK_TESTS") != "1", reason="set NN_NETWORK_TESTS=1")


@pytest.fixture(scope="module")
def gaz() -> Gazetteer:
    return Gazetteer.open(FIXTURES)


def label(g: Gazetteer, text: str) -> str | None:
    hit = g.resolve(text)
    return hit.label if hit else None


# ---------------------------------------------------------------- opening files


def test_open_missing_dir_raises(tmp_path):
    with pytest.raises(GazetteerMissing):
        Gazetteer.open(tmp_path)


def test_open_needs_both_files(tmp_path):
    (tmp_path / "gazetteer").mkdir()
    shutil.copy(FIXTURES / "gazetteer" / "2025_Gaz_place_national.txt", tmp_path / "gazetteer")
    with pytest.raises(GazetteerMissing):
        Gazetteer.open(tmp_path)


def test_open_reads_2024_tab_format_with_trailing_spaces():
    g = Gazetteer.open(FIXTURES / "legacy")
    hit = g.resolve("Arlington, VA")
    assert hit is not None and hit.label == "Arlington, VA"
    assert hit.lat == pytest.approx(38.878337) and hit.lon == pytest.approx(-77.100703)
    z = g.resolve("20001")
    assert z is not None and z.kind == "zip" and z.lon == pytest.approx(-77.017739)


def test_open_prefers_newest_year(tmp_path):
    gdir = tmp_path / "gazetteer"
    gdir.mkdir()
    for f in (FIXTURES / "legacy" / "gazetteer").iterdir():
        shutil.copy(f, gdir)
    for f in (FIXTURES / "gazetteer").iterdir():
        shutil.copy(f, gdir)
    g = Gazetteer.open(tmp_path)
    assert "2025_Gaz_place_national.txt" in g.source
    assert label(g, "Springfield, IL") == "Springfield, IL"  # only in the 2025 fixture


# ---------------------------------------------------------------- ZIPs


@pytest.mark.parametrize(
    "text",
    ["22201", "22201-1234", " 22201 ", "ZIP 22201", "Arlington, VA 22201",
     "1200 N Highland St, Arlington, VA 22201", "12345 Main St, Arlington, VA 22201", "22201 Arlington"],
)
def test_zip_anywhere_wins(gaz, text):
    hit = gaz.resolve(text)
    assert hit == GeoResult(
        label="ZIP 22201", kind="zip", lat=38.886804, lon=-77.094992, state="VA",
        note="Searching from the center of ZIP 22201",
    )


def test_zip_state_comes_from_its_prefix(gaz):
    assert gaz.resolve("20001").state == "DC"
    assert gaz.resolve("10001").state == "NY"
    assert gaz.resolve("63101").state == "MO"
    assert state_for_zip("20151") == "VA"  # 201xx is Northern Virginia, not DC
    assert state_for_zip("00901") == "PR"
    assert state_for_zip("96910") == ""  # Guam: not a supported state


def test_house_number_is_not_a_zip(gaz):
    hit = gaz.resolve("12000 Government Center Pkwy, Fairfax, VA")
    assert hit is not None and hit.kind == "city" and hit.label == "Fairfax, VA"


def test_zip_without_map_area_uses_nearby_zcta(gaz):
    hit = gaz.resolve("20013")  # a PO-box ZIP: no ZCTA
    assert hit is not None and hit.kind == "zip" and hit.label == "ZIP 20013"
    assert (hit.lat, hit.lon) == (38.979021, -77.030801)  # ZCTA 20012
    assert hit.state == "DC"
    assert "20012" in hit.note


def test_unknown_zip_with_city_uses_the_city(gaz):
    assert label(gaz, "PO Box 12, Arlington, VA 22210") == "Arlington, VA"


def test_unknown_zip_alone_is_none(gaz):
    assert gaz.resolve("99999") is None


# ---------------------------------------------------------------- cities


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Arlington, VA", "Arlington, VA"),
        ("arlington va", "Arlington, VA"),
        ("ARLINGTON, VIRGINIA", "Arlington, VA"),
        ("Arlington Virginia", "Arlington, VA"),
        ("Arlington, VA, USA", "Arlington, VA"),
        ("Arlington VA US", "Arlington, VA"),
        ("Arlington, Virginia, United States", "Arlington, VA"),
        ("Arlington, TX", "Arlington, TX"),
        ("Arlington Texas", "Arlington, TX"),
        ("1200 N Highland St, Arlington, VA", "Arlington, VA"),
        ("1200 N Highland St Arlington VA", "Arlington, VA"),
        ("Fairfax, VA", "Fairfax, VA"),
        ("Springfield, IL", "Springfield, IL"),
        ("springfield il", "Springfield, IL"),
        ("Springfield, Missouri", "Springfield, MO"),
        ("Springfield VA", "Springfield, VA"),
        ("St. Louis, MO", "St. Louis, MO"),
        ("Saint Louis, MO", "St. Louis, MO"),
        ("st louis mo", "St. Louis, MO"),
        ("St.Louis, Missouri", "St. Louis, MO"),
        ("Ste. Genevieve, MO", "Ste. Genevieve, MO"),
        ("Sainte Genevieve MO", "Ste. Genevieve, MO"),
        ("Mt. Vernon, VA", "Mount Vernon, VA"),
        ("Ft. Worth, TX", "Fort Worth, TX"),
        ("Fort Worth Texas", "Fort Worth, TX"),
        ("Falls Church, VA", "Falls Church, VA"),
        ("West Falls Church, VA", "West Falls Church, VA"),
        ("Bethesda, MD", "Bethesda, MD"),
        ("Cañon City, CO", "Cañon City, CO"),
        ("Canon City, CO", "Cañon City, CO"),
        ("O'Fallon, IL", "O'Fallon, IL"),
        ("OFallon IL", "O'Fallon, IL"),
        ("New York, NY", "New York, NY"),
        ("New York, New York", "New York, NY"),
        ("NYC", "New York, NY"),
        ("New York City", "New York, NY"),
        ("Brooklyn, NY", "Brooklyn, NY"),
        ("The Bronx, NY", "Bronx, NY"),
        ("San Juan, PR", "San Juan, PR"),
        ("San Juan, Puerto Rico", "San Juan, PR"),
    ],
)
def test_resolve_city(gaz, text, expected):
    hit = gaz.resolve(text)
    assert hit is not None, text
    assert hit.label == expected
    assert hit.kind == "city"
    assert hit.state == expected.rsplit(", ", 1)[1]
    assert hit.note == f"Searching from the center of {expected}"


@pytest.mark.parametrize(
    "text",
    ["Washington, DC", "Washington DC", "washington, d.c.", "DC", "D.C.", "District of Columbia",
     "Washington, District of Columbia", "1600 Pennsylvania Ave NW, Washington, DC"],
)
def test_resolve_dc(gaz, text):
    hit = gaz.resolve(text)
    assert hit is not None
    assert (hit.label, hit.state, hit.lat, hit.lon) == ("Washington, DC", "DC", 38.904243, -77.016524)


def test_city_point_is_the_census_internal_point(gaz):
    hit = gaz.resolve("Arlington, VA")
    assert (hit.lat, hit.lon) == (38.878337, -77.100703)


def test_same_name_prefers_active_government(gaz):
    # Fairfax, CA has a CDP (S) and a town (A): the town wins even though... it is the town.
    hit = gaz.resolve("Fairfax, CA")
    assert (hit.lat, hit.lon) == (37.988532, -122.595208)


def test_consolidated_city_names(gaz):
    assert label(gaz, "Nashville, TN") == "Nashville, TN"
    assert label(gaz, "Nashville-Davidson, TN") == "Nashville-Davidson, TN"
    assert label(gaz, "Indianapolis, IN") == "Indianapolis, IN"
    assert label(gaz, "Honolulu, HI") == "Honolulu, HI"
    assert label(gaz, "Ventura, CA") == "Ventura, CA"
    assert label(gaz, "Boise, ID") == "Boise, ID"
    assert label(gaz, "Carson City, NV") == "Carson City, NV"


def test_exact_name_beats_alias(gaz):
    # "Louisville city" (exact) beats the alias from "Louisville/Jefferson County metro government".
    hit = gaz.resolve("Louisville, KY")
    assert hit.label == "Louisville, KY"
    assert (hit.lat, hit.lon) == (38.224728, -85.740614)


@pytest.mark.parametrize(
    "text",
    ["", "   ", "Arlington", "Springfield", "New York", "Washington", "VA", "Virginia",
     "Atlantis, VA", "Arlington, MD", "hello world", "1200 N Highland St"],
)
def test_resolve_none(gaz, text):
    assert gaz.resolve(text) is None


def test_geo_result_is_frozen(gaz):
    hit = gaz.resolve("Arlington, VA")
    with pytest.raises(dataclasses.FrozenInstanceError):
        hit.lat = 0.0  # type: ignore[misc]


# ---------------------------------------------------------------- suggest


def labels(results):
    return [r.label for r in results]


def test_suggest_prefix_ranked_by_land_area(gaz):
    assert labels(gaz.suggest("Arl")) == ["Arlington, TX", "Arlington, VA"]
    assert labels(gaz.suggest("spring")) == ["Springfield, MO", "Springfield, IL", "Springfield, VA"]


def test_suggest_results_are_full_geo_results(gaz):
    first = gaz.suggest("Bethesda")[0]
    assert first == GeoResult(
        label="Bethesda, MD", kind="city", lat=38.987292, lon=-77.118612, state="MD",
        note="Searching from the center of Bethesda, MD",
    )


def test_suggest_exact_and_name_prefix_before_later_words(gaz):
    assert labels(gaz.suggest("Falls Church")) == ["Falls Church, VA", "West Falls Church, VA"]


def test_suggest_state_filter(gaz):
    assert labels(gaz.suggest("Springfield, M")) == ["Springfield, MO"]
    assert labels(gaz.suggest("Springfield, Il")) == ["Springfield, IL"]
    assert labels(gaz.suggest("springfield va")) == ["Springfield, VA"]
    assert gaz.suggest("Springfield, ZZ") == []


def test_suggest_abbreviations(gaz):
    assert labels(gaz.suggest("St. L")) == ["St. Louis, MO"]
    assert labels(gaz.suggest("Saint L")) == ["St. Louis, MO"]
    assert {"St. Louis, MO", "Ste. Genevieve, MO"} <= set(labels(gaz.suggest("St")))
    assert labels(gaz.suggest("Mt Ver")) == ["Mount Vernon, VA"]


def test_suggest_aliases_without_duplicates(gaz):
    assert labels(gaz.suggest("Nash")) == ["Nashville, TN"]
    assert labels(gaz.suggest("Louisv")) == ["Louisville, KY"]
    assert labels(gaz.suggest("Hono")) == ["Honolulu, HI"]


def test_suggest_needs_two_characters(gaz):
    assert gaz.suggest("") == []
    assert gaz.suggest("A") == []
    assert gaz.suggest(" s ") == []


def test_suggest_zip_prefixes(gaz):
    results = gaz.suggest("222")
    assert labels(results) == ["ZIP 22201", "ZIP 22203", "ZIP 22204", "ZIP 22205"]
    assert all(r.kind == "zip" and r.state == "VA" for r in results)
    assert labels(gaz.suggest("22201")) == ["ZIP 22201"]
    assert labels(gaz.suggest("100")) == ["ZIP 10001", "ZIP 10002"]
    assert gaz.suggest("12") == []
    assert gaz.suggest("999") == []


def test_suggest_limit(gaz):
    assert len(gaz.suggest("222", limit=2)) == 2
    assert len(gaz.suggest("Spring", limit=1)) == 1
    assert gaz.suggest("Spring", limit=0) == []


# ---------------------------------------------------------------- download (offline)


def _zip_bytes(path: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.write(path, arcname=path.name)
    return buf.getvalue()


def _serve(monkeypatch, routes: dict[str, bytes]) -> list[str]:
    """Patch httpx.Client inside the gazetteer module to answer from `routes`."""
    seen: list[str] = []
    real_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        body = routes.get(str(request.url))
        return httpx.Response(200, content=body) if body is not None else httpx.Response(404)

    def client(**kwargs):
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(gazetteer_module.httpx, "Client", client)
    return seen


def _url(year: int, kind: str) -> str:
    return gazetteer_module.GAZETTEER_URL.format(year=year, kind=kind)


def test_download_unzips_both_files(tmp_path, monkeypatch):
    src = FIXTURES / "gazetteer"
    seen = _serve(monkeypatch, {
        _url(2025, "place"): _zip_bytes(src / "2025_Gaz_place_national.txt"),
        _url(2025, "zcta"): _zip_bytes(src / "2025_Gaz_zcta_national.txt"),
    })
    Gazetteer.download(tmp_path)
    assert sorted(p.name for p in (tmp_path / "gazetteer").iterdir()) == [
        "2025_Gaz_place_national.txt", "2025_Gaz_zcta_national.txt"]
    assert len(seen) == 2
    assert label(Gazetteer.open(tmp_path), "Arlington, VA") == "Arlington, VA"

    # Idempotent: a second call makes no requests.
    Gazetteer.download(tmp_path)
    assert len(seen) == 2


def test_download_falls_back_to_previous_year(tmp_path, monkeypatch):
    src = FIXTURES / "legacy" / "gazetteer"
    _serve(monkeypatch, {
        _url(2024, "place"): _zip_bytes(src / "2024_Gaz_place_national.txt"),
        _url(2024, "zcta"): _zip_bytes(src / "2024_Gaz_zcta_national.txt"),
        _url(2025, "zcta"): b"not a zip file",
    })
    Gazetteer.download(tmp_path)
    names = sorted(p.name for p in (tmp_path / "gazetteer").iterdir())
    assert names == ["2024_Gaz_place_national.txt", "2024_Gaz_zcta_national.txt"]
    assert label(Gazetteer.open(tmp_path), "20001") == "ZIP 20001"


def test_download_failure_raises_and_leaves_no_partial_files(tmp_path, monkeypatch):
    _serve(monkeypatch, {})
    with pytest.raises(RuntimeError, match="Census Gazetteer"):
        Gazetteer.download(tmp_path)
    assert list((tmp_path / "gazetteer").iterdir()) == []


@pytest.mark.network
@network
def test_download_real_census_files(tmp_path):
    Gazetteer.download(tmp_path)
    g = Gazetteer.open(tmp_path)
    assert label(g, "Arlington, VA") == "Arlington, VA"
    assert label(g, "22201") == "ZIP 22201"
