"""Regression tests for the backend code review: user decisions win over running work, editor fixes are kept,
do-not-contact by name, the monthly limit, consistent warnings, cookie parsing, outages, rewrite conflicts."""

from __future__ import annotations

import json
import threading

from tests.conftest import Api
from tests.test_pipeline import OFFER, start_campaign, wait_done


def leads_of(api: Api, cid: str) -> list[dict]:
    return api.get(f"/api/campaigns/{cid}/leads").json()


def test_skip_and_dnc_during_research_are_never_overwritten(api: Api, fake_ai):
    api.onboard()
    fake_ai.delay_by_skill["researcher"] = 1.5
    _, camp = start_campaign(api, answer="no")
    cid = camp["id"]
    def two_busy():
        rows = [ld for ld in leads_of(api, cid) if ld["status"] in ("reading", "choosing")]
        return rows[:2] if len(rows) >= 2 else None

    a, b = api.wait(two_busy)
    assert api.post(f"/api/leads/{a['id']}/skip", {"reason": "Already a client"}).json()["lead"]["status"] == "skipped"
    assert api.post(f"/api/leads/{b['id']}/dnc", {"reason": "Asked us not to"}).json()["lead"]["status"] == "dnc"
    fake_ai.delay_by_skill.clear()
    wait_done(api, cid)
    la = api.get(f"/api/leads/{a['id']}").json()
    lb = api.get(f"/api/leads/{b['id']}").json()
    assert la["status"] == "skipped" and la["skip_reason"] == "Already a client" and la["email"] is None
    assert lb["status"] == "dnc" and lb["email"] is None
    drafted = [ld for ld in leads_of(api, cid) if ld["status"] in ("ready", "needs_review")]
    assert api.get("/api/account").json()["usage"]["used"] == len(drafted)  # the skipped lead isn't counted


def test_editor_fix_is_kept_even_without_a_fixes_list(api: Api, fake_ai):
    api.onboard()
    body = [
        [{"text": "Your home page says the practice offers family dentistry in Arlington.", "kind": "claim", "fact_ids": ["F1"]}],
        [{"text": "We run Google Ads for dental practices and focus on turning searches into booked visits for local offices.",
          "kind": "offer", "fact_ids": []},
         {"text": "One recent practice grew bookings by thirty percent in Fairfax after a few months of careful work together.",
          "kind": "offer", "fact_ids": []}],
        [{"text": "EDITOR-MARKER: would a free fifteen-minute audit next week be useful to you and the team there?",
          "kind": "other", "fact_ids": []},
         {"text": "If now is not a good time, that is fine, and thank you for reading this short note today.",
          "kind": "other", "fact_ids": []}],
    ]
    fixed = {"subject": "A quick idea for your practice", "greeting": "Hello team,", "paragraphs": body, "signoff": "Best,"}
    verdict = {"checks": {"facts": {"passed": False, "note": "S2 overstates the evidence."},
                          "rules": {"passed": True, "note": None}, "spam": {"passed": True, "note": None},
                          "subject": {"passed": True, "note": None}},
               "sentences": [], "fixes": [], "fixed_email": fixed}
    fake_ai.force_for("editor", 200, message={"content": [{"type": "text", "text": json.dumps(verdict)}]})
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    fixed_leads = []
    for ld in leads_of(api, camp["id"]):
        full = api.get(f"/api/leads/{ld['id']}").json()
        texts = " ".join(s["text"] for p in (full["email"] or {}).get("paragraphs", []) for s in p)
        if "EDITOR-MARKER" in texts:
            fixed_leads.append(full)
    assert len(fixed_leads) == 1
    lead = fixed_leads[0]
    assert lead["email"]["origin_detail"] == "fixed by the editor"
    assert lead["editor"]["fixes"]  # a plain note is recorded even when the editor listed none


def test_name_only_do_not_contact_blocks_the_business(api: Api):
    api.onboard()
    assert api.post("/api/dnc", {"business_name": "Sample Dental Studio, PC"}).status_code == 200
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    assert "Sample Dental Studio" not in {ld["name"] for ld in leads_of(api, camp["id"])}


def test_monthly_limit_counts_leads_still_being_researched(api: Api, fake_ai):
    api.onboard()
    api.c.app.state.nn.settings.monthly_lead_limit = 8
    fake_ai.delay_by_skill["researcher"] = 1.0
    _, camp = start_campaign(api, answer="no", lead_target=10)
    assert camp["lead_target"] == 8  # capped by the allowance
    api.wait(lambda: len([ld for ld in leads_of(api, camp["id"])
                          if ld["status"] in ("queued", "reading", "choosing", "writing", "checking")]) >= 5)
    r = api.post("/api/campaigns/plan", OFFER)
    plan = r.json()
    r = api.post("/api/campaigns", {"plan_id": plan["plan_id"], "input": OFFER, "answer": None if not plan["question"] else "no"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "usage_limit"
    assert "being researched" in r.json()["error"]["message"]
    fake_ai.delay_by_skill.clear()
    wait_done(api, camp["id"])


def test_has_warnings_matches_between_list_and_detail(api: Api, fake_ai):
    api.onboard()
    failing = {"checks": {"facts": {"passed": True, "note": None}, "rules": {"passed": False, "note": "Two asks."},
                          "spam": {"passed": True, "note": None}, "subject": {"passed": True, "note": None}},
               "sentences": [], "fixes": [], "fixed_email": None}
    for _ in range(3):
        fake_ai.force_for("editor", 200, message={"content": [{"type": "text", "text": json.dumps(failing)}]})
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    rows = leads_of(api, camp["id"])
    assert any(ld["status"] == "needs_review" for ld in rows)
    for ld in rows:
        detail = api.get(f"/api/leads/{ld['id']}").json()
        assert ld["has_warnings"] == detail["has_warnings"] == bool(detail["warnings"]), ld["name"]


def test_csrf_check_survives_other_apps_cookies(api: Api):
    api.c.cookies.set("other_app", '{"a": [1, 2]}')
    api.c.cookies.set("odd", 'a b"c')
    r = api.post("/api/admin/resume")
    assert r.status_code == 200, r.text


def test_outage_pauses_work_instead_of_failing_leads(api: Api, fake_ai):
    api.onboard()
    state = api.c.app.state.nn
    state.ai.outage_pause_s = 0.5
    state.settings.retry_delay_s = 0.5
    state.ai.sdk = state.ai.sdk.with_options(max_retries=0)
    for _ in range(3):
        fake_ai.force_for("researcher", 529, body={"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}})
    _, camp = start_campaign(api, answer="no")
    final = wait_done(api, camp["id"], timeout=120)
    rows = leads_of(api, camp["id"])
    assert not any("didn't respond" in (api.get(f"/api/leads/{ld['id']}").json()["error"] or "") for ld in rows)
    assert final["counts"]["ready"] + final["counts"]["needs_review"] >= 3
    calls = api.get("/api/admin/ai-calls?limit=200").json()
    assert sum(1 for c in calls if c["status"] == "error" and c["skill"] == "researcher") == 3


def test_rewrite_doesnt_overwrite_a_change_made_meanwhile(api: Api, fake_ai):
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    lid = next(ld["id"] for ld in leads_of(api, camp["id"]) if ld["status"] == "ready")
    fake_ai.delay_by_skill["writer"] = 1.5
    n0 = len(fake_ai.calls_for("writer"))
    result: dict = {}

    def run_rewrite() -> None:
        result["r"] = api.post(f"/api/leads/{lid}/rewrite", {"mode": "shorter"})

    t = threading.Thread(target=run_rewrite)
    t.start()
    api.wait(lambda: len(fake_ai.calls_for("writer")) > n0, timeout=10)
    assert api.post(f"/api/leads/{lid}/approve").status_code == 200
    assert api.post(f"/api/leads/{lid}/sent").status_code == 200
    t.join(timeout=30)
    assert result["r"].status_code == 409
    assert api.get(f"/api/leads/{lid}").json()["status"] == "sent"


def test_discovery_runs_once_per_campaign(api: Api):
    from nearbynudge.pipeline import steps

    api.onboard()
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    before = len(leads_of(api, camp["id"]))
    api.c.portal.call(steps.discover, api.c.app.state.nn, camp["id"])
    assert len(leads_of(api, camp["id"])) == before
