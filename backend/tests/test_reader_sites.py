"""The fixture business sites and their server."""

from __future__ import annotations

import datetime as dt
import json
import signal
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

from tests.sites.serve import SITE_NAMES, start_sites, stop_sites

SERVE = Path(__file__).resolve().parent / "sites" / "serve.py"


def test_fixture_sites_fixture_lists_every_site(fixture_sites):
    assert set(fixture_sites) == set(SITE_NAMES) == {
        "studio", "family", "nosolicit", "closed", "blocked", "botcheck", "injection",
    }
    assert all(url.startswith("http://127.0.0.1:") for url in fixture_sites.values())


def test_server_behaviour(fixture_sites):
    with httpx.Client(timeout=5) as client:
        moved = client.get(fixture_sites["family"] + "/about")
        assert moved.status_code == 301 and moved.headers["location"] == "/about/"
        about = client.get(fixture_sites["family"] + "/about/")
        assert about.status_code == 200 and about.headers["content-type"] == "text/html; charset=utf-8"
        assert f"© {dt.date.today().year} Sample Family Dental" in about.text and "%%YEAR%%" not in about.text
        challenge = client.get(fixture_sites["botcheck"] + "/")
        assert challenge.status_code == 503 and "Just a moment..." in challenge.text
        assert challenge.headers["cf-mitigated"] == "challenge"
        assert client.get(fixture_sites["botcheck"] + "/robots.txt").status_code == 200
        robots = client.get(fixture_sites["blocked"] + "/robots.txt")
        assert "User-agent: NearbyNudgeBot\nDisallow: /" in robots.text
        assert client.get(fixture_sites["studio"] + "/nope.html").status_code == 404
        assert client.get(fixture_sites["studio"] + "/../serve.py").status_code == 404


def test_start_and_stop_sites():
    urls = start_sites(names=("closed",))
    with httpx.Client(timeout=5) as client:
        assert "permanently closed" in client.get(urls["closed"] + "/").text
    stop_sites(urls)
    with pytest.raises(httpx.TransportError), httpx.Client(timeout=2) as client:
        client.get(urls["closed"] + "/")


def test_cli_prints_the_map_and_stops_cleanly():
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    proc = subprocess.Popen([sys.executable, str(SERVE), "--base-port", "0"], stdout=subprocess.PIPE, text=True,
                            creationflags=flags)
    try:
        urls = json.loads(proc.stdout.readline())
        assert list(urls) == list(SITE_NAMES)
        with httpx.Client(timeout=5) as client:
            assert client.get(urls["studio"] + "/").status_code == 200
        proc.send_signal(signal.CTRL_BREAK_EVENT if sys.platform == "win32" else signal.SIGTERM)
        assert proc.wait(timeout=10) == 0
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
        proc.stdout.close()
