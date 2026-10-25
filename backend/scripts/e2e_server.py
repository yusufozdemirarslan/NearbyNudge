"""A full NearbyNudge server for browser tests: the real backend and dashboard.

Default (no cost, no network): fixture business websites, seeded Arlington listings and a fake Claude API.
--live: the real Claude API from .env, the real listings file and real business websites (costs a little).
Either way it uses a fresh temporary app database, so your real data is never touched, and the test-only
workspace switch (POST /api/dev/workspace) is on, so each test can work in its own workspace.

    cd backend && .venv/Scripts/python.exe scripts/e2e_server.py --port 8100 [--live]
    # then in frontend/:  E2E_BASE_URL=http://localhost:8100 npx playwright test
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    import anthropic
    import httpx2

    from nearbynudge.app import create_app
    from nearbynudge.config import ROOT, Settings
    from nearbynudge.netserve import serve

    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8100)
    p.add_argument("--live", action="store_true", help="real Claude API, real listings and real websites")
    args = p.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="nn-e2e-"))
    data = tmp / "data"
    data.mkdir(parents=True)
    sites: dict[str, str] = {}
    common = dict(NN_DATA_DIR=data, NN_FRONTEND_DIST=ROOT / "frontend" / "dist", NN_DEV_WORKSPACES=True,
                  NN_PUBLIC_URL=f"http://localhost:{args.port}")
    http_client = None
    if args.live:
        shutil.copytree(ROOT / "data" / "gazetteer", data / "gazetteer")
        settings = Settings(NN_ENV="dev", NN_LISTINGS_PATH=ROOT / "data" / "listings.duckdb", **common)
        if not settings.ai_configured:
            sys.exit("ANTHROPIC_API_KEY isn't set in .env")
    else:
        from tests.conftest import GEO_FIXTURES, seed_listings
        from tests.fake_ai import FakeAI
        from tests.sites.serve import SITE_NAMES, start_sites

        (data / "gazetteer").mkdir()
        for f in GEO_FIXTURES.iterdir():
            shutil.copy(f, data / "gazetteer" / f.name)
        for i, name in enumerate(SITE_NAMES):
            sites.update(start_sites(host=f"127.0.0.{i + 2}", names=(name,)))
        seed_listings(data / "listings.duckdb", sites)
        fake = FakeAI()
        http_client = anthropic.DefaultAsyncHttpxClient(transport=httpx2.ASGITransport(app=fake.app))
        settings = Settings(NN_ENV="test", ANTHROPIC_API_KEY="sk-ant-fake", ANTHROPIC_BASE_URL="http://fake-ai",
                            NN_AI_RPM=10_000, NN_READER_ALLOW_PRIVATE=True, NN_READER_MIN_INTERVAL_S=0.0,
                            NN_WORKER_CONCURRENCY=3, **common)
    app = create_app(settings, ai_http_client=http_client)
    mode = "LIVE (real Claude, real listings and websites)" if args.live else "fake AI + fixture sites"
    print(f"E2E server [{mode}] on http://localhost:{args.port} (data in {tmp}); fixture sites: {sites}", flush=True)
    try:
        serve(app, args.port, log_level="warning")
    finally:
        if sites:
            from tests.sites.serve import stop_sites

            stop_sites(sites)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
