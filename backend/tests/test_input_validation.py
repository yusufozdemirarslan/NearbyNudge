"""Input validation at the API edge: blank (whitespace-only) text counts as empty for required fields, and
domains and email addresses are checked by the server as well as the dashboard."""

from __future__ import annotations

import pytest

from tests.conftest import PROFILE, Api
from tests.test_pipeline import OFFER, start_campaign, wait_done


@pytest.mark.parametrize("field", ["sender_name", "sender_company"])
def test_a_blank_profile_name_is_refused_and_nothing_is_saved(api: Api, field: str):
    api.onboard()
    r = api.put("/api/account/profile", {**PROFILE, field: "   \t "})
    assert r.status_code == 422, r.text
    assert field in r.json()["error"]["fields"]
    account = api.get("/api/account")
    assert account.status_code == 200, account.text
    assert account.json()["profile"][field] == PROFILE[field]


def test_profile_text_is_tidied_before_its_length_is_checked(api: Api):
    r = api.put("/api/account/profile", {**PROFILE, "sender_name": "  Maya    Chen  ", "sender_title": "   "})
    assert r.status_code == 200, r.text
    profile = r.json()["profile"]
    assert profile["sender_name"] == "Maya Chen"
    assert profile["sender_title"] == ""


@pytest.mark.parametrize("field", ["location", "industry", "offer_what", "offer_cta"])
def test_a_blank_campaign_brief_field_is_refused(api: Api, field: str):
    api.onboard()
    r = api.post("/api/campaigns/plan", {**OFFER, field: "     "})
    assert r.status_code == 422, r.text
    assert field in r.json()["error"]["fields"]


def test_a_blank_skip_reason_or_subject_is_refused(api: Api):
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    lead = next(ld for ld in api.get(f"/api/campaigns/{camp['id']}/leads").json() if ld["status"] in ("ready", "needs_review"))
    r = api.post(f"/api/leads/{lead['id']}/skip", {"reason": "   "})
    assert r.status_code == 422, r.text
    r = api.put(f"/api/leads/{lead['id']}/email", {"subject": "   ", "body": "Hi,\n\nA line.\n\nBest,"})
    assert r.status_code == 422, r.text
    detail = api.get(f"/api/leads/{lead['id']}").json()
    assert detail["status"] in ("ready", "needs_review")
    assert detail["email"]["subject"].strip()


@pytest.mark.parametrize("domain", ["not a domain", "example", ".com", "exa mple.com"])
def test_do_not_contact_refuses_something_that_isnt_a_domain(api: Api, domain: str):
    api.onboard()
    r = api.post("/api/dnc", {"domain": domain})
    assert r.status_code == 422, r.text
    assert "domain" in r.json()["error"]["fields"]
    assert api.get("/api/dnc").json() == []


def test_do_not_contact_keeps_the_site_of_a_full_address(api: Api):
    api.onboard()
    r = api.post("/api/dnc", {"domain": "https://www.Lakeside-Smiles.example/contact?x=1"})
    assert r.status_code == 200, r.text
    assert r.json()["domain"] == "lakeside-smiles.example"


@pytest.mark.parametrize("email", ["bad", "a b@example.com", "owner@example", "@example.com"])
def test_email_addresses_are_checked_by_the_server(api: Api, email: str):
    api.onboard()
    r = api.post("/api/dnc", {"email": email})
    assert r.status_code == 422, r.text
    r = api.post("/api/admin/optouts", {"domain": "optout-check.example", "contact_email": email})
    assert r.status_code == 422, r.text
    assert "contact_email" in r.json()["error"]["fields"]
    r = api.post("/api/public/optout", {"domain": "optout-check.example", "email": email})
    assert r.status_code == 422, r.text
    assert api.get("/api/admin/optouts").json() == []


def test_opt_outs_refuse_something_that_isnt_a_domain(api: Api):
    api.onboard()
    r = api.post("/api/admin/optouts", {"domain": "exa mple.com"})
    assert r.status_code == 422, r.text
    r = api.post("/api/admin/optouts", {"domain": "https://www.Optout-Ok.example/x", "contact_email": " Owner@Optout-Ok.example "})
    assert r.status_code == 200, r.text
    assert r.json()["domain"] == "optout-ok.example"
    assert r.json()["contact_email"] == "owner@optout-ok.example"
