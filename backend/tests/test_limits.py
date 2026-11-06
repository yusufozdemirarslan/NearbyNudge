"""The monthly lead allowance and the daily send cap can't be worked around: a campaign still finding businesses
holds its share, deleting data doesn't give anything back, retries need allowance left, and putting a sent lead on
the do-not-contact list doesn't free a send. The numbers page keeps sent emails sent."""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient

from nearbynudge.app import create_app
from nearbynudge.db import utcnow
from nearbynudge.models import Lead
from tests.conftest import Api, ai_http_client
from tests.test_pipeline import OFFER, start_campaign, wait_done


def leads_of(api: Api, cid: str) -> list[dict]:
    return api.get(f"/api/campaigns/{cid}/leads").json()


def drafted(api: Api, cid: str) -> list[str]:
    return [ld["id"] for ld in leads_of(api, cid) if ld["status"] in ("ready", "needs_review")]


def by_name(api: Api, cid: str) -> dict[str, dict]:
    return {ld["name"]: ld for ld in leads_of(api, cid)}


def used(api: Api) -> int:
    return api.get("/api/account").json()["usage"]["used"]


def sent_today(api: Api) -> int:
    return api.get("/api/account").json()["sending"]["sent_today"]


def send(api: Api, lead_id: str) -> dict:
    assert api.post(f"/api/leads/{lead_id}/approve").status_code == 200
    r = api.post(f"/api/leads/{lead_id}/sent")
    assert r.status_code == 200, r.text
    return r.json()


def finished_campaign(api: Api, **overrides) -> str:
    api.onboard()
    _, camp = start_campaign(api, answer="no", **overrides)
    wait_done(api, camp["id"])
    return camp["id"]


# ---------- the monthly allowance ----------

def test_a_campaign_still_finding_businesses_holds_its_share_of_the_allowance(api: Api, fake_ai):
    api.onboard()
    api.c.app.state.nn.settings.monthly_lead_limit = 10
    fake_ai.delay_by_skill["scout"] = 3.0  # the first campaign stays on "finding businesses" for a while
    _, first = start_campaign(api, answer="no", lead_target=10)
    assert first["lead_target"] == 10
    plan = api.post("/api/campaigns/plan", OFFER).json()
    r = api.post("/api/campaigns", {"plan_id": plan["plan_id"], "input": OFFER, "answer": "no" if plan["question"] else None})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "usage_limit"
    fake_ai.delay_by_skill.clear()
    wait_done(api, first["id"])


def test_deleting_campaigns_or_all_data_doesnt_give_the_allowance_back(api: Api):
    cid = finished_campaign(api)
    before = used(api)
    assert before > 0
    assert api.delete(f"/api/campaigns/{cid}").status_code == 204
    assert used(api) == before
    assert api.delete("/api/account", {"confirm": "delete"}).status_code == 204
    assert used(api) == before


def test_retrying_a_lead_needs_allowance_left(api: Api):
    cid = finished_campaign(api)
    state = api.c.app.state.nn
    state.settings.monthly_lead_limit = used(api)
    blocked = by_name(api, cid)["Sample Blocked Dental"]["id"]  # failed before it was drafted, so it isn't counted
    r = api.post(f"/api/leads/{blocked}/retry", {"mode": "without_site"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "usage_limit"
    assert api.get(f"/api/leads/{blocked}").json()["status"] == "failed"
    state.settings.monthly_lead_limit = used(api) + 5
    assert api.post(f"/api/leads/{blocked}/retry", {"mode": "without_site"}).status_code == 200


def test_discovery_takes_only_what_the_allowance_has_left(api: Api, fake_ai):
    api.onboard()
    state = api.c.app.state.nn
    fake_ai.delay_by_skill["scout"] = 2.0
    _, camp = start_campaign(api, answer="no", lead_target=5)
    state.settings.monthly_lead_limit = 2  # other work used up the rest of the allowance meanwhile
    fake_ai.delay_by_skill.clear()
    final = wait_done(api, camp["id"])
    assert final["lead_target"] == 2
    assert any("allowance" in n for n in final["notices"]), final["notices"]
    assert len(leads_of(api, camp["id"])) <= 2
    assert used(api) <= 2


# ---------- the daily send cap ----------

def test_do_not_contact_on_a_sent_lead_doesnt_free_a_send(api: Api):
    cid = finished_campaign(api)
    api.c.app.state.nn.settings.daily_send_cap = 1
    a, b = drafted(api, cid)[:2]
    assert send(api, a)["sending"]["sent_today"] == 1
    r = api.post(f"/api/leads/{a}/dnc", {"reason": "Asked us not to"})
    assert r.status_code == 200 and r.json()["lead"]["status"] == "dnc"
    assert r.json()["sending"]["sent_today"] == 1
    assert api.post(f"/api/leads/{b}/approve").status_code == 200
    r = api.post(f"/api/leads/{b}/sent")
    assert r.status_code == 409 and r.json()["error"]["code"] == "daily_cap_reached"


def test_deleting_a_campaign_doesnt_free_todays_sends(api: Api):
    cid = finished_campaign(api)
    send(api, drafted(api, cid)[0])
    assert api.delete(f"/api/campaigns/{cid}").status_code == 204
    assert sent_today(api) == 1


def test_undoing_a_send_still_frees_its_slot(api: Api):
    cid = finished_campaign(api)
    api.c.app.state.nn.settings.daily_send_cap = 1
    lid = drafted(api, cid)[0]
    body = send(api, lid)
    r = api.post(f"/api/actions/{body['action_id']}/undo")
    assert r.status_code == 200 and r.json()["sending"]["sent_today"] == 0
    r = api.post(f"/api/leads/{lid}/sent")
    assert r.status_code == 200 and r.json()["sending"]["sent_today"] == 1


# ---------- the numbers page ----------

def test_numbers_keep_a_sent_email_after_do_not_contact(api: Api):
    cid = finished_campaign(api)
    a, b = drafted(api, cid)[:2]
    send(api, a)
    assert api.post(f"/api/leads/{a}/dnc", {"reason": "Asked us not to"}).status_code == 200
    send(api, b)
    assert api.post(f"/api/leads/{b}/replied", {"outcome": "interested"}).status_code == 200
    assert api.post(f"/api/leads/{b}/dnc", {"reason": "Moved away"}).status_code == 200
    totals = api.get("/api/stats").json()["totals"]
    assert (totals["approved"], totals["sent"], totals["replied"]) == (2, 2, 1)
    assert totals["reply_rate"] == 0.5


def test_this_weeks_reply_rate_counts_only_the_emails_sent_this_week(api: Api):
    cid = finished_campaign(api)
    a, b, c = drafted(api, cid)[:3]
    for lid in (a, b, c):
        send(api, lid)

    def sent_last_week(s):
        for lid in (a, b):
            s.get(Lead, lid).sent_at = utcnow() - timedelta(days=7)
    api.c.app.state.nn.db.run(sent_last_week)
    for lid in (a, b):  # two emails from last week get their replies this week
        assert api.post(f"/api/leads/{lid}/replied", {"outcome": "interested"}).status_code == 200
    stats = api.get("/api/stats").json()
    this, last = stats["this_week"], stats["last_week"]
    assert (this["sent"], this["replied"]) == (1, 2)  # the counts stay as they were
    assert this["reply_rate"] == 0.0  # this week's one email has no reply yet
    assert (last["sent"], last["reply_rate"]) == (2, 1.0)
    empty = next(w for w in stats["weekly"] if w["sent"] == 0)
    assert empty is not None
    assert "reply_rate" not in empty or empty.get("reply_rate") is None


def test_a_week_with_nothing_sent_has_no_reply_rate(api: Api):
    api.onboard()
    stats = api.get("/api/stats").json()
    assert stats["this_week"]["reply_rate"] is None and stats["last_week"]["reply_rate"] is None


# ---------- databases from before the usage record ----------

def test_usage_from_before_the_usage_record_is_counted_once(api: Api, settings, fake_ai):
    from nearbynudge.models import UsageEvent

    cid = finished_campaign(api)
    send(api, drafted(api, cid)[0])
    expect = (used(api), sent_today(api))
    assert expect[0] > 0 and expect[1] == 1
    api.c.app.state.nn.db.run(lambda s: s.query(UsageEvent).delete())  # as if the record didn't exist yet
    for _ in range(2):  # starting the app counts what's there; starting it again doesn't count anything twice
        with TestClient(create_app(settings, ai_http_client=ai_http_client(fake_ai)), base_url="http://localhost:8000") as c:
            again = Api(c)
            assert (used(again), sent_today(again)) == expect
