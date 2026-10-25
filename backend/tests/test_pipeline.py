"""End-to-end pipeline tests: real reader against fixture sites, fake Claude API, real worker and database."""

from __future__ import annotations

from tests.conftest import Api

OFFER = {
    "location": "Arlington, VA", "radius_mi": 5, "industry": "Dentists",
    "offer_what": "Google Ads for dental practices", "offer_proof": "Grew bookings 30% for a Fairfax practice",
    "offer_cta": "A free 15-minute audit", "tone": "professional", "lead_target": 5,
}


def start_campaign(api: Api, answer: str | None = "yes", **overrides) -> tuple[dict, dict]:
    inp = {**OFFER, **overrides}
    r = api.post("/api/campaigns/plan", inp)
    assert r.status_code == 200, r.text
    plan = r.json()
    r = api.post("/api/campaigns", {"plan_id": plan["plan_id"], "input": inp, "answer": answer if plan["question"] else None})
    assert r.status_code == 200, r.text
    return plan, r.json()


def wait_done(api: Api, cid: str, timeout: float = 90) -> dict:
    def done():
        c = api.get(f"/api/campaigns/{cid}").json()
        return c if c["status"] == "done" else None
    return api.wait(done, timeout=timeout)


def test_plan_maps_industry_and_asks_one_question(api: Api, fake_ai):
    api.onboard()
    r = api.post("/api/campaigns/plan", OFFER)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["location"]["label"] == "Arlington, VA"
    assert plan["coverage"] == "ready"
    keys = {c["key"] for c in plan["categories"]}
    assert "general_dentistry" in keys and "hvac_service" not in keys
    assert plan["question"]["text"] == "Include orthodontists?"
    assert {c["key"] for c in plan["question"]["categories"]} == {"orthodontics"}
    assert "5 miles of Arlington, VA" in plan["restatement"]
    assert plan["candidate_count"] >= 5
    call = fake_ai.calls_for("planner")[0]
    req = call["request"]
    assert req["model"] == "claude-sonnet-5-5"
    assert req["output_config"]["effort"] == "medium"
    assert req["output_config"]["format"]["type"] == "json_schema"
    assert req["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in call["headers"].get("anthropic-beta", "")
    assert req["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "temperature" not in req and "thinking" not in req


def test_unknown_place_and_missing_profile(api: Api):
    r = api.post("/api/campaigns/plan", OFFER)
    assert r.status_code == 409 and r.json()["error"]["code"] == "profile_required"
    api.onboard()
    r = api.post("/api/campaigns/plan", {**OFFER, "location": "Springfield"})
    assert r.status_code == 422
    assert r.json()["error"]["fields"]["location"]
    r = api.post("/api/campaigns/plan", {**OFFER, "radius_mi": 40})
    assert r.status_code == 422 and "radius_mi" in r.json()["error"]["fields"]


def test_full_campaign_to_sending_preview(api: Api, fake_ai):
    api.onboard()
    plan, camp = start_campaign(api)
    cid = camp["id"]
    assert camp["status"] in ("finding", "researching")
    final = wait_done(api, cid)
    leads = api.get(f"/api/campaigns/{cid}/leads").json()
    by_name = {ld["name"]: ld for ld in leads}

    # the closed practice was replaced (hidden), blocked and bot-check sites couldn't be read
    assert "Sample Orthodontics" not in by_name
    assert final["counts"]["replaced"] >= 1
    assert any("closed" in n.lower() for n in final["notices"])
    assert by_name["Sample Blocked Dental"]["status"] == "failed"
    assert by_name["Sample Guarded Dental"]["status"] == "failed"
    assert final["finish_summary"]["found"] >= 3

    studio = by_name["Sample Dental Studio"]
    assert studio["status"] == "ready", studio
    assert studio["fit_label"] == "Strong" and studio["contact_kind"] == "email"
    lead = api.get(f"/api/leads/{studio['id']}").json()
    assert lead["contact"]["email"] == "office@samplestudio.example"
    assert lead["contact"]["source_label"] == "Contact page"
    assert lead["site_check"]["mobile_ready"] is False and lead["site_check"]["copyright_year"] == 2019
    assert lead["verification"]["status"] == "verified"
    research = [f for f in lead["facts"] if f["source_kind"] == "site" and f["quote"]]
    assert research and all(f["quote_found"] for f in research)
    assert any(f["fragment_url"] and "#:~:text=" in f["fragment_url"] for f in research)
    email = lead["email"]
    assert 80 <= email["word_count"] <= 130
    assert "Sample Dental Studio" in email["subject"]
    claims = [s for p in email["paragraphs"] for s in p if s["kind"] == "claim"]
    assert claims and all(s["state"] == "supported" for s in claims)
    assert lead["editor"]["passed"] == 4 and lead["warnings"] == []
    assert "Not interested? Reply \"no thanks\"" in email["footer"]
    assert "123 Example St" in email["footer"]
    assert lead["mailto_url"].startswith("mailto:office@samplestudio.example?subject=")
    assert "[1]" not in lead["copy_text"]
    assert lead["provenance"]["model"] == "claude-sonnet-5-5"

    # contact-form-only and no-solicitation sites
    family = api.get(f"/api/leads/{by_name['Sample Family Dental']['id']}").json()
    assert family["contact"]["kind"] == "form" and family["mailto_url"] is None
    smiles = api.get(f"/api/leads/{by_name['Sample Smiles']['id']}").json()
    assert smiles["contact"]["kind"] == "none" and "solicitation" in (smiles["contact"]["note"] or "").lower()

    # page text never reaches the AI unmasked
    research_calls = fake_ai.calls_for("researcher")
    sent_text = str([c["request"]["messages"] for c in research_calls])
    assert "office@samplestudio.example" not in sent_text
    assert "555-0100" not in sent_text

    # approve -> mark sent -> undo -> sent again -> replied "no thanks" -> do not contact
    r = api.post(f"/api/leads/{studio['id']}/approve")
    assert r.status_code == 200 and r.json()["lead"]["status"] == "approved"
    r = api.post(f"/api/leads/{studio['id']}/sent")
    body = r.json()
    assert body["lead"]["status"] == "sent" and body["sending"]["sent_today"] == 1
    r = api.post(f"/api/actions/{body['action_id']}/undo")
    assert r.json()["lead"]["status"] == "approved" and r.json()["sending"]["sent_today"] == 0
    api.post(f"/api/leads/{studio['id']}/sent")
    r = api.post(f"/api/leads/{studio['id']}/replied", {"outcome": "no_thanks"})
    assert r.json()["lead"]["status"] == "replied"
    dnc = api.get("/api/dnc").json()
    assert any(e["email"] == "office@samplestudio.example" and e["source"] == "reply" for e in dnc)

    # numbers and exports
    stats = api.get("/api/stats").json()
    assert stats["totals"]["sent"] == 1 and stats["totals"]["replied"] == 1 and stats["totals"]["reply_rate"] == 1.0
    assert stats["usage"]["used"] >= 3
    csv_text = api.get(f"/api/campaigns/{cid}/export.csv").text
    assert "Sample Dental Studio" in csv_text and "Subject" in csv_text
    sent = api.get("/api/sent").json()
    assert sent["items"][0]["name"] == "Sample Dental Studio"


def test_rewrite_edit_wrong_fact_and_skip(api: Api, fake_ai):
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    cid = camp["id"]
    wait_done(api, cid)
    leads = {ld["name"]: ld for ld in api.get(f"/api/campaigns/{cid}/leads").json()}
    lid = leads["Sample Dental Studio"]["id"]
    before = api.get(f"/api/leads/{lid}").json()

    r = api.post(f"/api/leads/{lid}/rewrite", {"mode": "shorter"})
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["previous_email"]["version_id"] == before["email"]["version_id"]
    assert after["email"]["origin"] == "rewrite" and after["email"]["word_count"] < before["email"]["word_count"]

    r = api.post(f"/api/leads/{lid}/rewrite", {"mode": "another_hook"})
    assert r.status_code == 200
    assert r.json()["hook"]["title"] == before["alternatives"][0]["title"]

    body = "Hello Sample Dental Studio team,\n\nI noticed your practice has served Arlington for years.\n\nWe help practices fill their calendars.\n\nBest,"
    r = api.put(f"/api/leads/{lid}/email", {"subject": "Hello", "body": body})
    assert r.status_code == 200
    edited = r.json()
    assert edited["email"]["origin"] == "edit" and edited["email"]["edited"]
    assert any("subject" in w.lower() for w in edited["warnings"]) or any("words" in w for w in edited["warnings"])

    restore_id = after["email"]["version_id"]
    r = api.post(f"/api/leads/{lid}/versions/{restore_id}/restore")
    assert r.status_code == 200 and r.json()["email"]["origin"] == "restore"

    lead = r.json()
    used = [f for f in lead["facts"] if f["used"] and f["source_kind"] == "site"]
    if used:
        r = api.post(f"/api/facts/{used[0]['id']}/wrong", {"note": "Not true"})
        assert r.status_code == 200, r.text
        flagged = next(f for f in r.json()["facts"] if f["id"] == used[0]["id"])
        assert flagged["flagged_wrong"] and not flagged["used"]

    fam = leads["Sample Family Dental"]["id"]
    r = api.post(f"/api/leads/{fam}/skip", {"reason": "Already a client"})
    assert r.json()["lead"]["status"] == "skipped" and r.json()["lead"]["skip_reason"] == "Already a client"
    r = api.post(f"/api/actions/{r.json()['action_id']}/undo")
    assert r.json()["lead"]["status"] == "ready"
    r = api.post(f"/api/leads/{fam}/dnc", {"reason": "Asked us not to"})
    assert r.json()["lead"]["status"] == "dnc"
    assert any(e["business_name"] == "Sample Family Dental" for e in api.get("/api/dnc").json())

    # a second campaign never brings back drafted or blocked businesses
    _, camp2 = start_campaign(api, answer="no")
    wait_done(api, camp2["id"])
    names2 = {ld["name"] for ld in api.get(f"/api/campaigns/{camp2['id']}/leads").json()}
    assert "Sample Dental Studio" not in names2 and "Sample Family Dental" not in names2


def test_daily_cap_and_retry_without_site(api: Api, settings):
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    leads = {ld["name"]: ld for ld in api.get(f"/api/campaigns/{camp['id']}/leads").json()}
    blocked = leads["Sample Blocked Dental"]
    lead = api.get(f"/api/leads/{blocked['id']}").json()
    assert lead["can_retry"] and "robots" in lead["error"].lower()
    r = api.post(f"/api/leads/{blocked['id']}/retry", {"mode": "without_site"})
    assert r.status_code == 200
    done = api.wait(lambda: (lambda x: x if x["status"] in ("ready", "needs_review") else None)(api.get(f"/api/leads/{blocked['id']}").json()))
    assert done["verification"]["status"] == "unverified"
    assert all(f["source_kind"] == "listing" for f in done["facts"])


def test_ai_pause_on_billing_error_then_resume(api: Api, fake_ai):
    api.onboard()
    fake_ai.force(400, body={"type": "error", "error": {"type": "invalid_request_error",
                                                         "message": "Your credit balance is too low to access the Anthropic API."}})
    r = api.post("/api/campaigns/plan", OFFER)
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_paused"
    status = api.get("/api/status").json()
    assert status["ai_state"] == "paused" and "out of credit" in status["message"]
    ov = api.get("/api/admin/overview").json()
    assert ov["ai"]["state"] == "paused" and ov["ai"]["reason"] == "balance"
    r = api.post("/api/admin/resume")
    assert r.json()["ai"]["state"] == "ok"
    assert api.post("/api/campaigns/plan", OFFER).status_code == 200


def test_malformed_answer_is_asked_again(api: Api, fake_ai):
    api.onboard()
    fake_ai.force(200, message={"content": [{"type": "text", "text": "{\"restatement\": \"\"}"}]})
    r = api.post("/api/campaigns/plan", OFFER)
    assert r.status_code == 200, r.text
    assert len(fake_ai.calls_for("planner")) == 2  # asked once more (QC2)
    second = fake_ai.calls_for("planner")[1]["request"]["messages"]
    assert second[-1]["role"] == "user" and "couldn't be used" in second[-1]["content"]


def test_admin_console(api: Api):
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    ov = api.get("/api/admin/overview").json()
    assert ov["spend"]["requests_today"] > 0 and ov["spend"]["by_skill"]
    assert ov["quality"]["avg_cost_per_lead"] is not None
    api.put("/api/admin/balance", {"amount": 50})
    assert api.get("/api/admin/overview").json()["balance"]["amount"] == 50
    calls = api.get("/api/admin/ai-calls?limit=5").json()
    assert len(calls) == 5 and calls[0]["skill"]
    sample = api.get("/api/admin/audit/sample?n=3").json()
    assert sample and sample[0]["facts"]
    fact_id = sample[0]["facts"][0]["fact"]["id"]
    assert api.post(f"/api/admin/audit/facts/{fact_id}", {"verdict": "supported"}).json()["ok"]
    oo = api.post("/api/admin/optouts", {"domain": "https://www.optedout.example/page"}).json()
    assert oo["domain"] == "optedout.example"


def test_public_optout(api: Api):
    r = api.post("/api/public/optout", {"domain": "samplestudio.example", "email": "owner@samplestudio.example"})
    assert r.status_code == 200 and r.json()["ok"]
    assert [o["domain"] for o in api.get("/api/admin/optouts").json()] == ["samplestudio.example"]


def test_live_events_stream(api: Api):
    assert api.get("/api/campaigns/nope/events").status_code == 404
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    with api.c.stream("GET", f"/api/campaigns/{camp['id']}/events") as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        seen = []
        for line in r.iter_lines():
            if line.startswith("event: "):
                seen.append(line.removeprefix("event: "))
            if "lead" in seen and "campaign" in seen:
                break
    assert seen[0] == "campaign" and "lead" in seen
    wait_done(api, camp["id"])
