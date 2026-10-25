pytest_plugins = ["tests.conftest_sites"]

import shutil  # noqa: E402
import time  # noqa: E402
from collections.abc import Iterator  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

import anthropic  # noqa: E402
import httpx2  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from nearbynudge.app import create_app  # noqa: E402
from nearbynudge.config import Settings  # noqa: E402
from nearbynudge.listings import Listing, ListingsStore  # noqa: E402
from nearbynudge.security import limiter  # noqa: E402
from tests.fake_ai import FakeAI  # noqa: E402
from tests.sites.serve import SITE_NAMES, start_sites, stop_sites  # noqa: E402

GEO_FIXTURES = Path(__file__).parent / "fixtures" / "geo" / "gazetteer"
ARLINGTON = (38.8816, -77.0910)  # Arlington CDP, VA internal point (approximately)
RELEASE = "2026-10-21.0"


def make_listing(place_id: str, name: str, *, website: str | None, lat: float, lon: float,
                 category: str = "general_dentistry", basic: str = "dental_clinic", label: str = "General dentistry",
                 emails: list[str] | None = None, street: str = "1200 N Example St") -> Listing:
    return Listing(
        place_id=place_id, name=name, category=category, basic_category=basic, category_label=label,
        hierarchy=["health_care", "outpatient_care_facility", basic, category], confidence=0.95, operating_status="open",
        websites=[website] if website else [], emails=emails or [],
        phones=[f"+1703555{sum(map(ord, place_id)) % 10000:04d}"], socials=[],
        street=street, locality="Arlington", region="VA", postcode="22201", country="US", lat=lat, lon=lon,
        brand=None, brand_wikidata=None, chain_count=1, source_dataset="meta", source_updated="2026-09-01",
        release=RELEASE,
    )


def seed_listings(path: Path, sites: dict[str, str]) -> None:
    lat, lon = ARLINGTON
    rows = [
        make_listing("p-studio", "Sample Dental Studio", website=sites["studio"] + "/", lat=lat + 0.004, lon=lon - 0.003),
        make_listing("p-family", "Sample Family Dental", website=sites["family"] + "/", lat=lat + 0.010, lon=lon + 0.006),
        make_listing("p-smiles", "Sample Smiles", website=sites["nosolicit"] + "/", lat=lat - 0.012, lon=lon + 0.004),
        make_listing("p-closed", "Sample Orthodontics", website=sites["closed"] + "/", lat=lat - 0.006, lon=lon - 0.010,
                     category="orthodontics", label="Orthodontics"),
        make_listing("p-blocked", "Sample Blocked Dental", website=sites["blocked"] + "/", lat=lat + 0.015, lon=lon - 0.012),
        make_listing("p-bot", "Sample Guarded Dental", website=sites["botcheck"] + "/", lat=lat - 0.018, lon=lon - 0.002),
        make_listing("p-kids", "Sample Pediatric Dentistry", website=sites["injection"] + "/", lat=lat + 0.020, lon=lon + 0.015,
                     category="pediatric_dentistry", label="Pediatric dentistry"),
        make_listing("p-nosite", "Sample Walk-in Dental", website=None, lat=lat + 0.003, lon=lon + 0.020),
        make_listing("p-hvac", "Sample Heating and Air", website="http://127.0.0.1:9/", lat=lat, lon=lon + 0.001,
                     category="hvac_service", basic="home_service", label="HVAC service"),
    ]
    store = ListingsStore(path)
    try:
        store.insert_listings(rows)
        register = getattr(store, "register_area", None)
        if register is not None:
            register("test area", lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5, release=RELEASE, rows=len(rows))
        else:  # until register_area exists
            from datetime import UTC, datetime

            from nearbynudge.listings import sql

            with store._cursor() as cur:  # noqa: SLF001
                cur.execute(sql.INSERT_AREA, ["test area", lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5, RELEASE,
                                              datetime.now(UTC).replace(tzinfo=None), len(rows)])
    finally:
        store.close()


#: The sender profile tests set up (the first-run step before campaigns can start).
PROFILE = {"sender_name": "Maya Chen", "sender_title": "", "sender_company": "Test Agency",
           "sender_address": "123 Example St, Arlington, VA 22201", "default_tone": "professional",
           "timezone": "America/New_York"}


class Api:
    """TestClient wrapper that sends the CSRF header like the dashboard does."""

    def __init__(self, client: TestClient):
        self.c = client
        self.c.get("/api/me")

    def _h(self) -> dict[str, str]:
        return {"X-CSRF-Token": self.c.cookies.get("nn_csrf") or ""}

    def get(self, path: str, **kw: Any):
        return self.c.get(path, **kw)

    def post(self, path: str, json: Any = None, **kw: Any):
        return self.c.post(path, json=json if json is not None else {}, headers=self._h(), **kw)

    def put(self, path: str, json: Any = None, **kw: Any):
        return self.c.put(path, json=json, headers=self._h(), **kw)

    def delete(self, path: str, json: Any = None, **kw: Any):
        return self.c.request("DELETE", path, json=json, headers=self._h(), **kw)

    def onboard(self) -> dict:
        """Saves the sender profile, like the first-run screen does; returns the workspace user."""
        r = self.put("/api/account/profile", PROFILE)
        assert r.status_code == 200, r.text
        return r.json()["user"]

    def wait(self, predicate, timeout: float = 30.0, interval: float = 0.2):
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            last = predicate()
            if last:
                return last
            time.sleep(interval)
        raise AssertionError(f"timed out waiting; last value: {last!r}")


@pytest.fixture(scope="session")
def business_sites() -> Iterator[dict[str, str]]:
    """Each fixture site on its own loopback address (127.0.0.2, .3, ...), so each is a separate website
    to the listings dedupe, the do-not-contact checks and the reader."""
    urls: dict[str, str] = {}
    try:
        for i, name in enumerate(SITE_NAMES):
            urls.update(start_sites(host=f"127.0.0.{i + 2}", names=(name,)))
        yield urls
    finally:
        stop_sites(urls)


@pytest.fixture
def fake_ai() -> FakeAI:
    return FakeAI()


@pytest.fixture
def settings(tmp_path: Path, business_sites: dict[str, str]) -> Settings:
    data = tmp_path / "data"
    (data / "gazetteer").mkdir(parents=True)
    for f in GEO_FIXTURES.iterdir():
        shutil.copy(f, data / "gazetteer" / f.name)
    seed_listings(data / "listings.duckdb", business_sites)
    return Settings(
        ANTHROPIC_API_KEY="sk-ant-test", ANTHROPIC_BASE_URL="http://fake-ai", AI_MODEL="claude-sonnet-5-5",
        NN_ENV="test", NN_DATA_DIR=data, NN_FRONTEND_DIST=tmp_path / "no-dist", NN_DEV_WORKSPACES=True,
        NN_READER_ALLOW_PRIVATE=True, NN_READER_MIN_INTERVAL_S=0.0, NN_WORKER_CONCURRENCY=3, NN_AI_RPM=10_000,
        NN_PUBLIC_URL="http://localhost:8000",
    )


def ai_http_client(fake: FakeAI) -> Any:
    return anthropic.DefaultAsyncHttpxClient(transport=httpx2.ASGITransport(app=fake.app))


@pytest.fixture
def api(settings: Settings, fake_ai: FakeAI) -> Iterator[Api]:
    limiter.reset()
    app = create_app(settings, ai_http_client=ai_http_client(fake_ai))
    with TestClient(app, base_url="http://localhost:8000") as client:
        yield Api(client)
