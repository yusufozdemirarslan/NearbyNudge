"""Pipeline fixes from the code review: AI pauses that end, outages and the one-day give-up, the per-lead cost limit,
"review without site facts", undo while a job waits, edited emails, the cost of fallback answers, and page checks
that must not hold up the server."""

from __future__ import annotations

import asyncio
import time
from datetime import timedelta
from typing import Any

import anthropic
import httpx2
import pytest
from fastapi import FastAPI

from nearbynudge import emailtext
from nearbynudge.ai.client import AIClient, AIPaused, AIUnavailable, CallContext
from nearbynudge.ai.pricing import cost_usd
from nearbynudge.db import utcnow
from nearbynudge.models import Campaign, EmailVersion, Job, Lead
from nearbynudge.pipeline import jobs as jobs_mod
from nearbynudge.pipeline import steps
from nearbynudge.pipeline import worker as worker_mod
from tests.conftest import Api
from tests.test_pipeline import start_campaign, wait_done
from tests.test_races import seed_lead


def leads_of(api: Api, cid: str) -> list[dict]:
    return api.get(f"/api/campaigns/{cid}/leads").json()


def by_name(api: Api, cid: str) -> dict[str, dict]:
    return {ld["name"]: ld for ld in leads_of(api, cid)}


def finished_campaign(api: Api, **overrides) -> str:
    api.onboard()
    _, camp = start_campaign(api, answer="no", **overrides)
    wait_done(api, camp["id"])
    return camp["id"]


def stop_worker(api: Api):
    state = api.c.app.state.nn
    api.c.portal.call(state.worker.stop)  # these tests run jobs by hand
    return state


# ---------- AI pauses ----------

def test_an_expired_ai_pause_is_read_without_writing(api: Api, monkeypatch):
    pause = api.c.app.state.nn.pause
    pause.pause("rate_limited", seconds=0.2)
    time.sleep(0.4)
    writes: list[Any] = []
    monkeypatch.setattr(pause, "_save", lambda: writes.append("save"))
    assert pause.state() is None
    assert pause.paused() == (False, None)
    assert writes == []  # reading it is safe inside any open transaction


def test_acting_on_a_lead_right_after_an_ai_pause_ends_doesnt_hang(api: Api):
    cid = finished_campaign(api)
    state = stop_worker(api)  # nothing else notices the expiry first
    lid = next(ld["id"] for ld in leads_of(api, cid) if ld["status"] == "ready")
    state.pause.pause("rate_limited", seconds=0.2)
    time.sleep(0.4)
    started = time.monotonic()
    r = api.post(f"/api/leads/{lid}/approve")
    assert r.status_code == 200, r.text
    assert time.monotonic() - started < 5


# ---------- outages: give up only after a day of trying ----------

def queued_job(state, cid: str, lid: str, *, hours_old: float = 0) -> dict[str, Any]:
    def fn(s) -> dict[str, Any]:
        j = jobs_mod.enqueue(s, kind="lead", user_id="default", campaign_id=cid, lead_id=lid)
        j.created_at = utcnow() - timedelta(hours=hours_old)
        j.status = "running"
        return {"id": j.id, "kind": "lead", "user_id": "default", "campaign_id": cid, "lead_id": lid,
                "attempts": 1, "created_at": j.created_at}
    return state.db.run(fn)


class Clock:
    def __init__(self) -> None:
        self.now = utcnow()

    def __call__(self):
        return self.now

    def later(self, hours: float) -> None:
        self.now += timedelta(hours=hours)


@pytest.fixture
def clock(monkeypatch) -> Clock:
    c = Clock()
    monkeypatch.setattr(worker_mod, "utcnow", c)
    monkeypatch.setattr(jobs_mod, "utcnow", c)
    return c


def run_job(api: Api, state, job: dict[str, Any], monkeypatch, error: Exception | None,
            stage: str | None = None) -> None:
    async def process(app, lead_id):
        if stage is not None:
            await steps.aupdate_lead(app, lead_id, status=stage)  # the work got this far before the AI went away
        if error is not None:
            raise error
    monkeypatch.setattr(steps, "process_lead", process)
    api.c.portal.call(state.worker._run_job, job)


UNREACHABLE = AIUnavailable("The AI is rate limited right now.", code="rate_limited", status=429)
GAVE_UP = "Couldn't finish: the AI wasn't reachable for a day. Retry when it's back."


def lead_and_job(state, lid: str, job_id: str) -> tuple[str, str | None, str]:
    return state.db.run(lambda s: (s.get(Lead, lid).status, s.get(Lead, lid).error, s.get(Job, job_id).status))


def test_an_old_job_gets_a_full_day_from_the_start_of_an_outage(api: Api, monkeypatch, clock):
    state = stop_worker(api)
    cid, lid = seed_lead(state, "queued")
    job = queued_job(state, cid, lid, hours_old=25)  # it waited out a long account pause, a weekend, a restart
    run_job(api, state, job, monkeypatch, UNREACHABLE)
    assert lead_and_job(state, lid, job["id"]) == ("queued", None, "queued")
    clock.later(23)
    run_job(api, state, job, monkeypatch, UNREACHABLE)
    assert lead_and_job(state, lid, job["id"]) == ("queued", None, "queued")
    clock.later(2)  # a day after the outage began
    run_job(api, state, job, monkeypatch, UNREACHABLE)
    assert lead_and_job(state, lid, job["id"]) == ("failed", GAVE_UP, "failed")


def test_progress_or_an_account_pause_starts_the_outage_day_again(api: Api, monkeypatch, clock):
    state = stop_worker(api)
    cid, lid = seed_lead(state, "reading")
    job = queued_job(state, cid, lid)
    run_job(api, state, job, monkeypatch, UNREACHABLE)
    clock.later(23)
    run_job(api, state, job, monkeypatch, UNREACHABLE, stage="writing")  # research finished, then the AI went away
    clock.later(20)
    run_job(api, state, job, monkeypatch, UNREACHABLE)
    assert lead_and_job(state, lid, job["id"])[0] == "writing"  # 43 hours, but only 20 since the work moved on
    run_job(api, state, job, monkeypatch, AIPaused("The Anthropic account is out of credit.", code="balance"))
    clock.later(30)  # the account was topped up after a long weekend
    run_job(api, state, job, monkeypatch, UNREACHABLE)
    assert lead_and_job(state, lid, job["id"]) == ("writing", None, "queued")


# ---------- the per-lead cost limit ----------

def test_research_doesnt_start_once_a_lead_is_over_its_cost_limit(api: Api, fake_ai):
    state = stop_worker(api)
    _, lid = seed_lead(state, "queued", cost_usd=state.settings.lead_cost_cap_usd + 0.01)
    api.c.portal.call(steps.process_lead, state, lid)
    status, error = state.db.run(lambda s: (s.get(Lead, lid).status, s.get(Lead, lid).error))
    assert (status, error) == ("failed", steps.COST_CAP_MESSAGE)
    assert fake_ai.calls_for("researcher") == []


def test_a_draft_over_its_cost_limit_isnt_retried_away(api: Api):
    cid = finished_campaign(api)
    state = api.c.app.state.nn
    lid = next(ld["id"] for ld in leads_of(api, cid) if ld["status"] == "ready")

    def over_cap(s) -> None:
        lead = s.get(Lead, lid)
        lead.status = "needs_review"  # e.g. after a few rewrites
        lead.cost_usd = state.settings.lead_cost_cap_usd + 0.05
    state.db.run(over_cap)
    r = api.post(f"/api/leads/{lid}/retry", {"mode": "retry"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "cost_limit"
    assert api.get(f"/api/leads/{lid}").json()["status"] == "needs_review"
    assert api.post(f"/api/leads/{lid}/approve").status_code == 200  # the draft can still be used


# ---------- review without site facts ----------

def test_review_without_site_facts_leaves_out_what_the_site_said(api: Api, fake_ai):
    cid = finished_campaign(api)
    state = api.c.app.state.nn
    lid = by_name(api, cid)["Sample Dental Studio"]["id"]
    assert state.db.run(lambda s: s.get(Lead, lid).summary)  # the site research described the business
    state.db.run(lambda s: setattr(s.get(Lead, lid), "status", "needs_review"))
    n0 = len(fake_ai.calls_for("writer"))
    r = api.post(f"/api/leads/{lid}/retry", {"mode": "without_site"})
    assert r.status_code == 200, r.text
    fields = state.db.run(lambda s: (lambda ld: (ld.summary, ld.owner_name, ld.fit_score, ld.fit_reason))(s.get(Lead, lid)))
    assert fields == (None, None, None, None)
    api.wait(lambda: api.get(f"/api/leads/{lid}").json()["status"] in ("ready", "needs_review"))
    prompts = [str(c["request"]["messages"]) for c in fake_ai.calls_for("writer")[n0:]]
    prompts = [p for p in prompts if "Sample Dental Studio" in p]
    assert prompts
    assert not any("What it does (from research)" in p or "Published owner" in p for p in prompts)


# ---------- undo while the lead's job is waiting ----------

def test_undoing_a_skip_while_the_leads_job_waits_reopens_the_campaign(api: Api):
    state = stop_worker(api)  # the lead's job stays queued, as during an AI pause
    cid, lid = seed_lead(state, "reading")
    state.db.run(lambda s: jobs_mod.enqueue(s, kind="lead", user_id="default", campaign_id=cid, lead_id=lid))
    r = api.post(f"/api/leads/{lid}/skip", {"reason": "Not now"})
    assert r.status_code == 200, r.text
    assert api.get(f"/api/campaigns/{cid}").json()["status"] == "done"
    r = api.post(f"/api/actions/{r.json()['action_id']}/undo")
    assert r.status_code == 200 and r.json()["lead"]["status"] == "reading"
    assert api.get(f"/api/campaigns/{cid}").json()["status"] == "researching"
    assert state.db.run(lambda s: s.get(Campaign, cid).finished_at) is None


# ---------- edited emails ----------

def test_sentences_keep_their_closing_quotes():
    assert emailtext.split_sentences("Your home page promises “same-day crowns.” We help practices like yours.") == [
        "Your home page promises “same-day crowns.”", "We help practices like yours."]
    assert emailtext.split_sentences('They say "we love kids." We help.') == ['They say "we love kids."', "We help."]
    assert emailtext.split_sentences("(We checked twice.) The rest follows. Dr. Lee agrees.") == [
        "(We checked twice.)", "The rest follows.", "Dr. Lee agrees."]


def compose_body(email: dict[str, Any]) -> str:
    """The body text the dashboard's editor sends: greeting, paragraphs, signoff, with blank lines between."""
    paragraphs = [" ".join(s["text"] for s in p) for p in email["paragraphs"]]
    return "\n\n".join([email["greeting"], *paragraphs, email["signoff"]])


def test_saving_an_unchanged_quoted_claim_keeps_it_checked(api: Api):
    cid = finished_campaign(api)
    state = api.c.app.state.nn
    lid = by_name(api, cid)["Sample Dental Studio"]["id"]

    def quote_the_claim(s) -> None:
        lead = s.get(Lead, lid)
        v = s.get(EmailVersion, lead.email_version_id)
        paras = [list(p) for p in v.paragraphs]
        claim = dict(paras[0][0])
        assert claim["kind"] == "claim" and claim["verified"]
        claim["text"] = "Your home page promises “same-day crowns.”"
        paras[0] = [claim, {"id": "s0", "text": "We help practices like yours turn searches into booked visits.",
                            "kind": "offer", "fact_ids": [], "verified": None, "edited": False}]
        v.paragraphs = paras
    state.db.run(quote_the_claim)
    email = api.get(f"/api/leads/{lid}").json()["email"]
    assert email["paragraphs"][0][0]["state"] == "supported"
    r = api.put(f"/api/leads/{lid}/email", {"subject": email["subject"], "body": compose_body(email)})
    assert r.status_code == 200, r.text
    first = r.json()["email"]["paragraphs"][0][0]
    assert first["text"] == "Your home page promises “same-day crowns.”"
    assert first["edited"] is False and first["state"] == "supported"
    assert not any("edited claim" in w for w in r.json()["warnings"])


def test_a_warning_is_listed_once(api: Api):
    cid = finished_campaign(api)
    lid = next(ld["id"] for ld in leads_of(api, cid) if ld["status"] == "ready")
    subject = "Sample Dental Studio and a quick idea for your busy Arlington family practice"
    r = api.put(f"/api/leads/{lid}/email", {"subject": subject, "body": "Hello team,\n\nA short note about your practice.\n\nBest,"})
    assert r.status_code == 200, r.text
    warnings = r.json()["warnings"]
    assert sum(1 for w in warnings if "words; aim for" in w) == 1, warnings
    assert sum(1 for w in warnings if w.startswith("The subject has")) == 1, warnings


# ---------- the cost of a fallback answer ----------

async def test_a_fallback_answer_is_charged_for_every_attempt():
    declined = {"type": "message", "model": "claude-sonnet-5-5", "input_tokens": 535, "output_tokens": 0,
                "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    served = {"type": "fallback_message", "model": "claude-sonnet-5", "input_tokens": 412, "output_tokens": 264,
              "cache_read_input_tokens": 100, "cache_creation_input_tokens": 0}
    api = FastAPI()

    @api.post("/v1/messages")
    async def messages() -> dict[str, Any]:
        return {"id": "msg_fallback", "type": "message", "role": "assistant", "model": "claude-sonnet-5",
                "content": [{"type": "text", "text": "OK"}], "stop_reason": "end_turn", "stop_sequence": None,
                "usage": {"input_tokens": 412, "output_tokens": 264, "cache_read_input_tokens": 100,
                          "cache_creation_input_tokens": 0, "iterations": [declined, served]}}

    rows: list[dict[str, Any]] = []

    async def recorder(ctx, row) -> None:
        rows.append(row)

    http = anthropic.DefaultAsyncHttpxClient(transport=httpx2.ASGITransport(app=api))
    ai = AIClient(api_key="sk-ant-test", base_url="http://fake-ai", http_client=http, max_retries=0, recorder=recorder)
    resp = await ai.create(CallContext(skill="planner"), system="# NearbyNudge Planner",
                           messages=[{"role": "user", "content": "hi"}])
    await ai.aclose()
    expected = (cost_usd("claude-sonnet-5-5", input_tokens=535, cache_write_tokens=0, cache_read_tokens=0, output_tokens=0)
                + cost_usd("claude-sonnet-5", input_tokens=412, cache_write_tokens=0, cache_read_tokens=100, output_tokens=264))
    assert resp.cost_usd == pytest.approx(expected)
    assert rows[0]["cost_usd"] == pytest.approx(expected)
    assert (rows[0]["input_tokens"], rows[0]["cache_read_tokens"], rows[0]["output_tokens"]) == (947, 100, 264)


# ---------- page checks ----------

def test_page_checks_run_off_the_event_loop(api: Api, monkeypatch):
    seen: list[tuple[str, bool]] = []

    def on_loop() -> bool:
        try:
            asyncio.get_running_loop()
            return True
        except RuntimeError:
            return False

    real_check, real_contact = steps.site_check, steps.find_contact

    def site_check(*a, **kw):
        seen.append(("site_check", on_loop()))
        return real_check(*a, **kw)

    def find_contact(*a, **kw):
        seen.append(("find_contact", on_loop()))
        return real_contact(*a, **kw)

    monkeypatch.setattr(steps, "site_check", site_check)
    monkeypatch.setattr(steps, "find_contact", find_contact)
    finished_campaign(api)
    assert {name for name, _ in seen} == {"site_check", "find_contact"}
    assert not any(loop for _, loop in seen), seen  # a slow page can't stop the server answering


def test_a_page_whose_links_cant_be_read_still_gets_a_draft(api: Api, monkeypatch):
    def broken(home, limit=20):
        raise RecursionError("maximum recursion depth exceeded")

    monkeypatch.setattr(steps, "pick_links", broken)
    cid = finished_campaign(api)
    studio = by_name(api, cid)["Sample Dental Studio"]
    assert studio["status"] in ("ready", "needs_review"), studio
    assert any(e["where"] == "reader" for e in api.get("/api/admin/errors").json())
