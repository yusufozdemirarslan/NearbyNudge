"""Live updates go out only once the change they announce is saved, so a browser that reloads a lead
when it hears about it never gets the old version. Updates from a change that isn't saved are dropped."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from nearbynudge.db import Database, after_commit
from nearbynudge.models import Lead
from tests.conftest import Api
from tests.test_pipeline import start_campaign, wait_done

# How far along the pipeline a status is; a saved status may be further along than an event, never behind.
STAGE = {"missing": -1, "queued": 0, "reading": 1, "choosing": 2, "writing": 3, "checking": 4}


def _watch(app, monkeypatch) -> list[tuple[str, str, str]]:
    """Records (lead id, status in the event, status other readers see) for every lead event sent."""
    seen: list[tuple[str, str, str]] = []
    real = app.broker.publish

    def publish(campaign_id, event, data):
        if event == "lead":
            with app.db.SessionLocal() as other:  # a separate connection sees only saved changes
                row = other.get(Lead, data["id"])
                saved = row.status if row is not None else "missing"
            seen.append((data["id"], "replaced" if data.get("replaced") else data["status"], saved))
        real(campaign_id, event, data)

    monkeypatch.setattr(app.broker, "publish", publish)
    return seen


def test_lead_actions_are_announced_only_after_they_are_saved(api: Api, monkeypatch):
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    lead = next(ld for ld in api.get(f"/api/campaigns/{camp['id']}/leads").json()
                if ld["status"] in ("ready", "needs_review"))
    seen = _watch(api.c.app.state.nn, monkeypatch)

    assert api.post(f"/api/leads/{lead['id']}/approve").status_code == 200
    assert seen == [(lead["id"], "approved", "approved")]
    seen.clear()
    sent = api.post(f"/api/leads/{lead['id']}/sent")
    assert sent.status_code == 200
    assert seen == [(lead["id"], "sent", "sent")]
    seen.clear()
    assert api.post(f"/api/actions/{sent.json()['action_id']}/undo").status_code == 200
    assert seen == [(lead["id"], "approved", "approved")]


def test_research_progress_is_announced_only_after_it_is_saved(api: Api, monkeypatch):
    api.onboard()
    seen = _watch(api.c.app.state.nn, monkeypatch)
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    assert len(seen) >= 10
    behind = [s for s in seen if STAGE.get(s[2], 5) < STAGE.get(s[1], 5)]
    assert not behind, behind


def test_after_commit_waits_for_the_commit_and_drops_unsaved_changes(tmp_path):
    db = Database(f"sqlite:///{(tmp_path / 'events.db').as_posix()}")
    db.create_all()
    calls: list[str] = []

    with db.session() as s:
        after_commit(s, lambda: calls.append("saved"))
        assert calls == []  # not before the commit
    assert calls == ["saved"]

    with pytest.raises(RuntimeError), db.session() as s:
        after_commit(s, lambda: calls.append("rolled back"))
        raise RuntimeError("the change fails")

    s = db.SessionLocal()
    s.execute(text("select 1"))
    after_commit(s, lambda: calls.append("closed without saving"))
    s.close()
    s.commit()  # a closed session can be used again; the dropped update must not come back
    s.close()

    def broken() -> None:
        raise ValueError("a listener failed")

    with db.session() as s:  # one failing update doesn't stop the others or the commit
        after_commit(s, broken)
        after_commit(s, lambda: calls.append("after a failure"))
    assert calls == ["saved", "after a failure"]
    db.dispose()
