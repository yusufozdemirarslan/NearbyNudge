"""A decision the user saves while background work is writing the same lead always wins.

SQLite here (the Python driver's legacy mode) opens a transaction only at the first write, so a plain read and
then a write isn't atomic. Each test holds a user's change open (written, not yet saved) right in that window and
checks that the user's change is what's left afterwards."""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import pytest

from nearbynudge.models import Campaign, DncEntry, Lead, User
from nearbynudge.pipeline import actions, steps
from tests.conftest import Api
from tests.test_pipeline import OFFER, start_campaign, wait_done


def seed_lead(app, status: str, **fields: Any) -> tuple[str, str]:
    """A campaign with one lead in the given state, in the built-in workspace (no job, so the worker leaves it alone)."""
    def fn(s):
        c = Campaign(user_id="default", name="Dentists within 5 mi of Arlington, VA", location_label="Arlington, VA",
                     lat=38.88, lon=-77.09, radius_mi=5, industry="Dentists", input=dict(OFFER), status="researching",
                     lead_target=5)
        s.add(c)
        s.flush()
        ld = Lead(campaign_id=c.id, user_id="default", place_id=f"p-race-{c.id}", name="Sample Race Dental", status=status,
                  **fields)
        s.add(ld)
        s.flush()
        return c.id, ld.id
    return app.db.run(fn)


@contextmanager
def user_change_held_open(app, lead_id: str, change: Callable[[Any, Lead, User], Any]) -> Iterator[None]:
    """Make the user's change in its own transaction and keep it unsaved (holding the write lock) until the block ends,
    like a request that is still putting its response together."""
    written, release = threading.Event(), threading.Event()
    errors: list[BaseException] = []

    def run() -> None:
        try:
            with app.db.session() as s:
                change(s, s.get(Lead, lead_id), s.get(User, "default"))
                s.flush()
                written.set()
                release.wait(10)
        except BaseException as exc:  # noqa: BLE001 - reported below
            errors.append(exc)
            written.set()

    t = threading.Thread(target=run)
    t.start()
    assert written.wait(10)
    try:
        yield
    finally:
        release.set()
        t.join(30)
    assert not errors, errors


def in_thread(fn: Callable[[], Any]) -> tuple[threading.Thread, dict[str, Any]]:
    out: dict[str, Any] = {}

    def target() -> None:
        try:
            out["value"] = fn()
        except BaseException as exc:  # noqa: BLE001 - checked by the test
            out["error"] = exc

    t = threading.Thread(target=target)
    t.start()
    return t, out


def status_of(app, lead_id: str) -> str:
    return app.db.run(lambda s: s.get(Lead, lead_id).status)


def skip(app):
    return lambda s, lead, user: actions.skip(app, s, lead, user, "Already a client")


def test_a_skip_saved_while_research_moves_the_lead_on_is_kept(api: Api):
    app = api.c.app.state.nn
    _, lid = seed_lead(app, "reading")
    with user_change_held_open(app, lid, skip(app)):
        t, out = in_thread(lambda: steps.update_lead(app, lid, status="choosing", step=2, stage_label="Choosing hook"))
        time.sleep(0.5)  # the research stage has looked at the lead and waits to write
    t.join(30)
    assert "error" not in out, out
    assert out["value"] is None  # the stage saw the skip and stopped
    assert status_of(app, lid) == "skipped"


def test_a_do_not_contact_saved_while_the_draft_is_saved_is_kept(api: Api):
    app = api.c.app.state.nn
    _, lid = seed_lead(app, "checking")

    def editor_save(s, ld: Lead) -> str:  # the end of the Editor stage: the draft becomes ready
        ld.status, ld.step, ld.stage_label = "ready", None, None
        return ld.status

    dnc = lambda s, lead, user: actions.do_not_contact(app, s, lead, user, "Asked us not to")  # noqa: E731
    with user_change_held_open(app, lid, dnc):
        t, out = in_thread(lambda: asyncio.run(steps.guarded(app, lid, editor_save)))
        time.sleep(0.5)
    t.join(30)
    assert "error" not in out, out
    assert out["value"] == (False, None)
    status, entries = app.db.run(lambda s: (s.get(Lead, lid).status, s.query(DncEntry).count()))
    assert status == "dnc" and entries == 1


@pytest.mark.parametrize("ending", ["replace", "fail", "dnc"])
def test_a_skip_saved_while_the_pipeline_ends_the_lead_is_kept(api: Api, ending: str):
    app = api.c.app.state.nn
    _, lid = seed_lead(app, "reading")
    snap = app.db.run(lambda s: steps.lead_snapshot(s.get(Lead, lid)))
    end = {
        "replace": lambda: steps._replace(app, snap, "Looked closed: the site says it closed"),
        "fail": lambda: steps._fail_and_replace(app, snap, "Couldn't read site: the website couldn't be reached."),
        "dnc": lambda: steps._dnc_and_replace(app, snap),
    }[ending]
    with user_change_held_open(app, lid, skip(app)):
        t, out = in_thread(lambda: asyncio.run(end()))
        time.sleep(0.5)
    t.join(30)
    assert "error" not in out, out
    assert status_of(app, lid) == "skipped"


def test_the_worker_doesnt_fail_a_lead_the_user_skipped_meanwhile(api: Api):
    app = api.c.app.state.nn
    cid, lid = seed_lead(app, "writing")
    job = {"id": "no-such-job", "kind": "lead", "lead_id": lid, "campaign_id": cid, "user_id": "default"}
    with user_change_held_open(app, lid, skip(app)):
        t, out = in_thread(lambda: asyncio.run(app.worker._give_up(job, "Couldn't finish: something went wrong on our side.")))
        time.sleep(0.5)
    t.join(30)
    assert "error" not in out, out
    assert status_of(app, lid) == "skipped"


def test_approving_while_a_rewrite_runs_keeps_the_approval(api: Api, fake_ai):
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    lid = next(ld["id"] for ld in api.get(f"/api/campaigns/{camp['id']}/leads").json() if ld["status"] == "ready")
    before = api.get(f"/api/leads/{lid}").json()["email"]["version_id"]
    fake_ai.delay_by_skill["writer"] = 1.5
    n0 = len(fake_ai.calls_for("writer"))
    result: dict[str, Any] = {}
    t = threading.Thread(target=lambda: result.update(r=api.post(f"/api/leads/{lid}/rewrite", {"mode": "shorter"})))
    t.start()
    api.wait(lambda: len(fake_ai.calls_for("writer")) > n0, timeout=10)
    assert api.post(f"/api/leads/{lid}/approve").status_code == 200
    t.join(30)
    assert result["r"].status_code == 409, result["r"].text
    assert result["r"].json()["error"]["code"] == "conflict"
    lead = api.get(f"/api/leads/{lid}").json()
    assert lead["status"] == "approved"
    assert lead["email"]["version_id"] == before  # the approved email is the one that stays
