"""No sign-in: everyone who opens the app uses one built-in workspace. The only first-run step is the
sender profile that emails need. "Delete all data" starts over. Tests get separate workspaces through a
switch that only test servers turn on."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from nearbynudge.app import create_app
from tests.conftest import PROFILE, Api, ai_http_client
from tests.test_pipeline import OFFER, start_campaign


def dnc_domains(api: Api) -> list[str | None]:
    return [e["domain"] for e in api.get("/api/dnc").json()]


def test_the_app_opens_without_signing_in(api: Api):
    me = api.get("/api/me")
    assert me.status_code == 200
    assert me.json()["user"]["onboarded"] is False
    assert api.get("/api/campaigns").json() == []
    # the one first-run step left: the sender profile emails need
    r = api.post("/api/campaigns/plan", OFFER)
    assert r.status_code == 409 and r.json()["error"]["code"] == "profile_required"
    acct = api.put("/api/account/profile", PROFILE).json()
    assert acct["user"]["onboarded"] is True and acct["user"]["name"] == "Maya Chen"
    assert api.get("/api/me").json()["user"] == acct["user"]
    assert api.post("/api/campaigns/plan", OFFER).status_code == 200


def test_sign_in_endpoints_are_gone(api: Api):
    for path in ("/api/auth/me", "/api/admin/invites", "/api/admin/users"):
        assert api.get(path).status_code == 404, path
    for path in ("/api/auth/login/options", "/api/auth/register/options", "/api/auth/recover", "/api/auth/logout",
                 "/api/account/recovery-codes", "/api/account/passkeys/options", "/api/admin/invites", "/api/dev/login"):
        assert api.post(path).status_code == 404, path


def test_the_admin_console_needs_no_admin_role(api: Api):
    assert api.get("/api/admin/overview").status_code == 200
    assert api.post("/api/admin/optouts", {"domain": "https://www.optedout.example/page"}).json()["domain"] == "optedout.example"
    assert api.post("/api/admin/resume").status_code == 200


def test_delete_all_data_starts_over(api: Api):
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    assert api.post("/api/dnc", {"domain": "keepaway.example"}).status_code == 200
    r = api.delete("/api/account", {"confirm": "maya@brightline.example"})
    assert r.status_code == 422 and "confirm" in r.json()["error"]["fields"]
    assert api.get(f"/api/campaigns/{camp['id']}").status_code == 200  # nothing was deleted

    assert api.delete("/api/account", {"confirm": " Delete "}).status_code == 204
    assert api.get("/api/me").json()["user"]["onboarded"] is False
    assert api.get("/api/campaigns").json() == []
    assert api.get(f"/api/campaigns/{camp['id']}").status_code == 404
    assert dnc_domains(api) == []
    assert api.get("/api/account").json()["profile"] is None
    # and the app keeps working from a fresh start
    assert api.onboard()["onboarded"] is True
    assert api.post("/api/campaigns/plan", OFFER).status_code == 200


def test_test_workspaces_keep_parallel_tests_apart(api: Api):
    default = api.get("/api/me").json()["user"]
    a = api.post("/api/dev/workspace", {"key": "worker-a"}).json()["user"]
    assert a["id"] != default["id"] and a["onboarded"] is True
    assert api.post("/api/dnc", {"domain": "only-a.example"}).status_code == 200

    b = api.post("/api/dev/workspace", {"key": "worker-b", "onboarded": False}).json()["user"]
    assert b["id"] not in (a["id"], default["id"]) and b["onboarded"] is False
    assert api.get("/api/me").json()["user"]["id"] == b["id"]
    assert dnc_domains(api) == []

    assert api.post("/api/dev/workspace", {"key": "worker-a"}).json()["user"]["id"] == a["id"]
    assert dnc_domains(api) == ["only-a.example"]
    api.c.cookies.delete("nn_dev_workspace")
    assert api.get("/api/me").json()["user"]["id"] == default["id"]
    assert dnc_domains(api) == []


def test_the_real_app_has_no_workspace_switch(settings, fake_ai):
    real = settings.model_copy(update={"dev_workspaces": False})
    with TestClient(create_app(real, ai_http_client=ai_http_client(fake_ai)), base_url="http://localhost:8000") as client:
        api = Api(client)
        assert api.post("/api/dev/workspace", {"key": "x"}).status_code == 404
        default = api.get("/api/me").json()["user"]["id"]
        client.cookies.set("nn_dev_workspace", "dev-0123456789abcdef0123")
        assert api.get("/api/me").json()["user"]["id"] == default


def test_production_refuses_the_workspace_switch(settings):
    with pytest.raises(RuntimeError, match="NN_DEV_WORKSPACES"):
        settings.model_copy(update={"env": "prod"}).validate_for_start()
