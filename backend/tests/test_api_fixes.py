"""API fixes from the code review: exports with any campaign name, odd CSRF tokens, campaign names, the radius hint,
opt-outs and audit verdicts sent twice at once, locked emails, cancelled rewrites, live updates that open while
something changes, a server that stops promptly, and the admin console's "today"."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event

from nearbynudge.models import AiCall, AuditVerdict, Campaign, Fact, OptOut, User
from tests.conftest import Api
from tests.test_pipeline import start_campaign, wait_done


def leads_of(api: Api, cid: str) -> list[dict]:
    return api.get(f"/api/campaigns/{cid}/leads").json()


def finished_campaign(api: Api, **overrides) -> str:
    api.onboard()
    _, camp = start_campaign(api, answer="no", **overrides)
    wait_done(api, camp["id"])
    return camp["id"]


def first_ready(api: Api, cid: str) -> str:
    return next(ld["id"] for ld in leads_of(api, cid) if ld["status"] == "ready")


@pytest.fixture
def slow_inserts(api: Api):
    """Make saving a new row of the given types slow, so two requests that arrive together both check before
    either has saved: the window a double submit hits."""
    state = api.c.app.state.nn
    kinds: list[type] = []

    def slow(session, _flush_context, _instances) -> None:
        if any(isinstance(obj, tuple(kinds)) for obj in session.new):
            time.sleep(0.4)

    event.listen(state.db.SessionLocal, "before_flush", slow)
    yield kinds
    event.remove(state.db.SessionLocal, "before_flush", slow)


def twice_at_once(fn) -> list[Any]:
    results: list[Any] = []
    threads = [threading.Thread(target=lambda: results.append(fn())) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    return results


# ---------- exports, CSRF, names, hints ----------

def test_a_campaign_with_any_name_can_be_exported(api: Api):
    cid = finished_campaign(api)
    state = api.c.app.state.nn
    state.db.run(lambda s: setattr(s.get(Campaign, cid), "name", "Diş hekimleri within 5 mi of Utqiaġvik, AK"))
    r = api.get(f"/api/campaigns/{cid}/export.csv")
    assert r.status_code == 200, r.text
    disposition = r.headers["content-disposition"]
    assert disposition.isascii()
    assert 'filename="dis-hekimleri-within-5-mi-of-utqiagvik--ak.csv"' in disposition
    assert "filename*=UTF-8''di%C5%9F-hekimleri-within-5-mi-of-utqia%C4%A1vik--ak.csv" in disposition


def test_a_csrf_token_with_odd_characters_is_refused_not_an_error(api: Api):
    r = api.c.post("/api/admin/resume", headers={"X-CSRF-Token": "tökén ✓".encode()})
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "csrf"


def test_campaign_names_keep_the_industrys_capitals(api: Api):
    api.onboard()
    _, camp = start_campaign(api, answer="no", industry="HVAC Services")
    assert camp["name"].startswith("HVAC Services within 5 mi of "), camp["name"]
    wait_done(api, camp["id"])
    _, camp = start_campaign(api, answer="no", industry="dentists")
    assert camp["name"].startswith("Dentists within 5 mi of "), camp["name"]
    wait_done(api, camp["id"])


def test_the_hint_doesnt_suggest_the_radius_already_chosen(api: Api):
    api.onboard()
    plan, camp = start_campaign(api, answer="no", radius_mi=25, lead_target=25)
    assert plan["warnings"], plan
    assert not any("25-mile" in w for w in plan["warnings"]), plan["warnings"]
    assert any("broader industry" in w for w in plan["warnings"])
    final = wait_done(api, camp["id"], timeout=150)
    found = [n for n in final["notices"] if n.startswith("We found")]
    assert found and not any("25-mile" in n for n in found), final["notices"]


# ---------- the same thing sent twice at once ----------

def test_an_opt_out_sent_twice_at_once_is_added_once(api: Api, slow_inserts):
    slow_inserts.append(OptOut)
    results = twice_at_once(lambda: api.post("/api/admin/optouts", {"domain": "twice.example"}))
    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]
    assert results[0].json()["id"] == results[1].json()["id"]
    assert [o["domain"] for o in api.get("/api/admin/optouts").json()] == ["twice.example"]


def test_an_audit_verdict_sent_twice_at_once_is_kept_once(api: Api, slow_inserts):
    cid = finished_campaign(api)
    state = api.c.app.state.nn
    lead_ids = [ld["id"] for ld in leads_of(api, cid)]
    fact_id = state.db.run(lambda s: s.query(Fact.id).filter(Fact.lead_id.in_(lead_ids)).first()[0])
    slow_inserts.append(AuditVerdict)
    results = twice_at_once(lambda: api.post(f"/api/admin/audit/facts/{fact_id}", {"verdict": "supported"}))
    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]
    assert state.db.run(lambda s: s.query(AuditVerdict).filter_by(fact_id=fact_id).count()) == 1
    assert api.get("/api/admin/overview").json()["quality"]["audited_facts"] == 1


# ---------- approved emails are locked ----------

def test_an_approved_or_sent_email_cant_be_edited_or_restored(api: Api):
    cid = finished_campaign(api)
    lid = first_ready(api, cid)
    lead = api.get(f"/api/leads/{lid}").json()
    version = lead["email"]["version_id"]
    edit = {"subject": "A different subject", "body": "Hello team,\n\nA different email.\n\nBest,"}
    assert api.post(f"/api/leads/{lid}/approve").status_code == 200
    for r in (api.put(f"/api/leads/{lid}/email", edit), api.post(f"/api/leads/{lid}/versions/{version}/restore")):
        assert r.status_code == 409, r.text
        assert r.json()["error"] == {"code": "conflict", "message": "Undo the approval to change this email."}
    assert api.post(f"/api/leads/{lid}/sent").status_code == 200
    for r in (api.put(f"/api/leads/{lid}/email", edit), api.post(f"/api/leads/{lid}/versions/{version}/restore")):
        assert r.status_code == 409, r.text
        assert r.json()["error"] == {"code": "conflict", "message": "This email can't be changed now."}
    after = api.get(f"/api/leads/{lid}").json()
    assert after["status"] == "sent" and after["email"]["version_id"] == version


# ---------- cancelling a rewrite ----------

@pytest.fixture
def client_gone(monkeypatch):
    """The browser stopped waiting (Cancel): the request's connection is closed."""
    from starlette.requests import Request

    async def gone(self) -> bool:
        return True

    monkeypatch.setattr(Request, "is_disconnected", gone)


def test_a_cancelled_rewrite_changes_nothing(api: Api, client_gone):
    cid = finished_campaign(api)
    lid = first_ready(api, cid)
    before = api.get(f"/api/leads/{lid}").json()
    r = api.post(f"/api/leads/{lid}/rewrite", {"mode": "shorter"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "cancelled"
    after = api.get(f"/api/leads/{lid}").json()
    assert after["email"]["version_id"] == before["email"]["version_id"]
    assert after["status"] == before["status"] and after["previous_email"] == before["previous_email"]


def test_a_cancelled_wrong_fact_report_changes_nothing(api: Api, client_gone):
    cid = finished_campaign(api)
    lid = first_ready(api, cid)
    before = api.get(f"/api/leads/{lid}").json()
    used = next(f for f in before["facts"] if f["used"])
    r = api.post(f"/api/facts/{used['id']}/wrong", {"note": "Not true"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "cancelled"
    after = api.get(f"/api/leads/{lid}").json()
    fact = next(f for f in after["facts"] if f["id"] == used["id"])
    assert not fact["flagged_wrong"] and fact["used"] and fact["state"] == used["state"]
    assert after["email"]["version_id"] == before["email"]["version_id"] and after["warnings"] == before["warnings"]


# ---------- live updates ----------

def test_live_updates_keep_a_change_made_while_the_stream_opens(api: Api, monkeypatch):
    from nearbynudge.api import campaigns as campaigns_api

    cid = finished_campaign(api)
    state = api.c.app.state.nn
    real = campaigns_api._summary

    def snapshot_then_change(s, c, app):
        out = real(s, c, app)
        state.broker.publish(c.id, "lead", {"id": "changed-meanwhile"})  # saved just after the snapshot was taken
        return out

    monkeypatch.setattr(campaigns_api, "_summary", snapshot_then_change)
    with api.c.stream("GET", f"/api/campaigns/{cid}/events") as r:
        assert r.status_code == 200
        for line in r.iter_lines():
            if line.startswith("data: ") and "changed-meanwhile" in line:
                break
            assert not line.startswith("event: ping"), "the change made while the stream opened was lost"


def test_the_server_stops_promptly_even_with_live_updates_open(monkeypatch):
    from nearbynudge import netserve

    seen: dict[str, Any] = {}

    class FakeServer:
        def __init__(self, config) -> None:
            seen["config"] = config

        def run(self, sockets=None) -> None:
            for sock in sockets or []:
                sock.close()

    monkeypatch.setattr(netserve.uvicorn, "Server", FakeServer)
    netserve.serve(lambda scope, receive, send: None, 0)
    timeout = seen["config"].timeout_graceful_shutdown
    assert timeout is not None and 0 < timeout <= 10  # open live-update streams can't hold Ctrl+C forever


# ---------- the admin console's "today" ----------

def test_admin_spend_today_uses_the_workspace_time_zone(api: Api):
    from nearbynudge.pipeline.limits import local_day_bounds

    api.onboard()  # America/New_York
    state = api.c.app.state.nn

    def add(s) -> None:
        start, _ = local_day_bounds(s.get(User, "default"))
        s.add(AiCall(created_at=start - timedelta(minutes=30), skill="writer", model="claude-sonnet-5-5", cost_usd=1.0))
        s.add(AiCall(created_at=start + timedelta(minutes=1), skill="writer", model="claude-sonnet-5-5", cost_usd=2.0))

    state.db.run(add)
    spend = api.get("/api/admin/overview").json()["spend"]
    assert spend["today"] == 2.0 and spend["requests_today"] == 1
    today = datetime.now(ZoneInfo("America/New_York")).date()
    days = {d["date"]: d for d in spend["daily"]}
    assert days[today.isoformat()]["cost"] == 2.0
    assert days[(today - timedelta(days=1)).isoformat()]["cost"] == 1.0
