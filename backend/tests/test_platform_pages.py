"""Businesses whose website is a page on a shared platform (a Facebook page, a Linktree, a business.site address)
are told apart by the page, not the platform: blocking or drafting one never holds back the others.

The worker is stopped wherever a lead could be brought in, so nothing here ever reads a real platform page."""

from __future__ import annotations

from nearbynudge.models import Campaign, Candidate, DncEntry, Lead
from nearbynudge.pipeline import steps
from tests.conftest import ARLINGTON, Api, make_listing
from tests.test_races import seed_lead

PAGE_A = "https://www.facebook.com/smiledental"
PAGE_B = "https://www.facebook.com/brightsmilesarlington"


def blocked(state, website: str) -> bool:
    return state.db.run(lambda s: steps.is_dnc(s, "default", place_id="p-elsewhere", websites=[website], email=None,
                                               name="A Different Name"))


def add_candidate(state, cid: str, place_id: str, name: str, website: str, rank: int) -> None:
    listing = make_listing(place_id, name, website=website, lat=ARLINGTON[0], lon=ARLINGTON[1])
    state.db.run(lambda s: s.add(Candidate(campaign_id=cid, place_id=place_id, rank=rank,
                                           listing=steps._listing_dict(listing), status="reserve")))


def promote(state, cid: str) -> str | None:
    def fn(s):
        lead = steps.promote_next(state, s, s.get(Campaign, cid))
        return lead.name if lead else None
    return state.db.run(fn)


def without_worker(api: Api):
    state = api.c.app.state.nn
    api.c.portal.call(state.worker.stop)  # a promoted lead's job must never run: it would visit the real page
    return state


def test_a_business_blocked_by_its_facebook_page_blocks_only_that_page(api: Api):
    state = without_worker(api)
    _, lid = seed_lead(state, "ready", website=PAGE_A, domain="facebook.com")
    assert api.post(f"/api/leads/{lid}/dnc", {"reason": "Asked us not to"}).status_code == 200
    assert state.db.run(lambda s: s.query(DncEntry.domain).scalar()) == "facebook.com/smiledental"
    assert blocked(state, PAGE_A) and blocked(state, "facebook.com/SmileDental/")
    assert not blocked(state, PAGE_B)


def test_a_drafted_facebook_page_doesnt_hold_back_other_pages(api: Api):
    state = without_worker(api)
    cid, _ = seed_lead(state, "ready", website=PAGE_A, domain="facebook.com")  # drafted, so not suggested again
    _places, domains, _emails, _names = state.db.run(lambda s: steps.user_excludes(s, "default"))
    assert "facebook.com/smiledental" in domains and "facebook.com" not in domains
    add_candidate(state, cid, "p-page-b", "Bright Smiles Arlington", PAGE_B, rank=2)
    assert promote(state, cid) == "Bright Smiles Arlington"
    add_candidate(state, cid, "p-page-a-again", "Smile Dental (second listing)", PAGE_A, rank=3)
    assert promote(state, cid) is None  # the drafted business's own page stays out


def test_a_typed_facebook_page_blocks_exactly_that_page(api: Api):
    state = without_worker(api)
    api.onboard()
    r = api.post("/api/dnc", {"domain": "https://www.facebook.com/SmileDental?ref=page"})
    assert r.status_code == 200, r.text
    assert r.json()["domain"] == "facebook.com/smiledental"
    assert blocked(state, PAGE_A) and not blocked(state, PAGE_B)
    cid, _ = seed_lead(state, "ready", website="https://othersite.example/", domain="othersite.example")
    add_candidate(state, cid, "p-page-a", "Smile Dental", PAGE_A, rank=2)
    add_candidate(state, cid, "p-page-b", "Bright Smiles", PAGE_B, rank=3)
    assert promote(state, cid) == "Bright Smiles"


def test_typing_only_a_platform_is_refused(api: Api):
    api.onboard()
    r = api.post("/api/dnc", {"domain": "facebook.com"})
    assert r.status_code == 422, r.text
    assert "domain" in r.json()["error"]["fields"]
    assert api.get("/api/dnc").json() == []


def test_ordinary_websites_block_as_before(api: Api):
    state = without_worker(api)
    api.onboard()
    assert api.post("/api/dnc", {"domain": "https://www.smile.example/contact"}).json()["domain"] == "smile.example"
    assert blocked(state, "http://smile.example") and blocked(state, "https://arlington.smile.example/x")
    assert not blocked(state, "https://smile-dental.example")
    cid, lid = seed_lead(state, "ready", website="https://drafted.example/", domain="drafted.example")
    add_candidate(state, cid, "p-drafted-again", "Drafted Again", "https://www.drafted.example/about", rank=2)
    add_candidate(state, cid, "p-blocked-again", "Blocked Again", "https://shop.smile.example", rank=3)
    add_candidate(state, cid, "p-fresh", "Fresh Dental", "https://fresh.example", rank=4)
    assert promote(state, cid) == "Fresh Dental"
    assert api.post(f"/api/leads/{lid}/dnc", {"reason": "Asked us not to"}).status_code == 200
    domains = state.db.run(lambda s: sorted(d for (d,) in s.query(DncEntry.domain).all()))
    assert domains == ["drafted.example", "smile.example"]
    assert state.db.run(lambda s: s.get(Lead, lid).status) == "dnc"
