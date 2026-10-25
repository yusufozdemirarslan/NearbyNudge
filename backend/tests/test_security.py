"""Security without sign-in: the CSRF check, security headers, and the host-name check.

There is no sign-in, so anyone who can reach the server can use it. The server listens only on this
computer, and the host-name check stops a web page from reaching it by pointing its own name at
127.0.0.1 (DNS rebinding): the browser would send that page's name, not "localhost"."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from nearbynudge.app import create_app
from tests.conftest import Api, ai_http_client
from tests.test_pipeline import OFFER


def test_unsafe_requests_need_the_csrf_header(api: Api):
    api.onboard()
    r = api.c.post("/api/campaigns/plan", json=OFFER)
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf"
    assert api.post("/api/campaigns/plan", OFFER).status_code == 200


def test_security_headers_and_spa_fallback(api: Api):
    r = api.get("/api/health")
    csp = r.headers["content-security-policy"]
    assert "default-src 'self'" in csp and "connect-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert r.headers["x-content-type-options"] == "nosniff"
    assert api.get("/api/does-not-exist").json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("host", ["localhost:8000", "LocalHost:8000", "127.0.0.1:8000", "[::1]:8000", "localhost"])
def test_local_addresses_are_served(api: Api, host: str):
    assert api.get("/api/health", headers={"host": host}).status_code == 200
    assert api.get("/", headers={"host": host}).status_code != 400


@pytest.mark.parametrize("host", ["evil.example:8000", "localhost.evil.example:8000", "127.0.0.1.nip.io", "[::2]:8000"])
def test_other_host_names_are_refused(api: Api, host: str):
    r = api.get("/api/health", headers={"host": host})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_host"
    csrf = api.c.cookies.get("nn_csrf") or ""
    assert api.c.post("/api/admin/resume", json={}, headers={"host": host, "X-CSRF-Token": csrf}).status_code == 400
    assert api.get("/campaigns/new", headers={"host": host}).status_code == 400


def test_the_public_address_is_served_too(settings, fake_ai):
    hosted = settings.model_copy(update={"public_url": "https://nudge.example.org"})
    with TestClient(create_app(hosted, ai_http_client=ai_http_client(fake_ai)), base_url="https://nudge.example.org") as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/health", headers={"host": "other.example.org"}).status_code == 400
