"""Requests that arrive twice at once (a double-click, a double-submit) still do the work once."""

from __future__ import annotations

import threading
import time

from tests.conftest import Api
from tests.test_pipeline import OFFER


def test_a_double_submitted_plan_starts_one_campaign(api: Api, monkeypatch):
    from nearbynudge.api import campaigns as campaigns_api

    api.onboard()
    plan = api.post("/api/campaigns/plan", OFFER).json()
    body = {"plan_id": plan["plan_id"], "input": OFFER, "answer": "no" if plan["question"] else None}
    enqueue = campaigns_api.jobs.enqueue

    def slow_enqueue(*args, **kwargs):
        time.sleep(0.5)  # hold the first request half-way, so the second arrives while it's still starting
        return enqueue(*args, **kwargs)

    monkeypatch.setattr(campaigns_api.jobs, "enqueue", slow_enqueue)
    results: list = []
    threads = [threading.Thread(target=lambda: results.append(api.post("/api/campaigns", body))) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
    assert next(r for r in results if r.status_code == 409).json()["error"]["code"] == "plan_expired"
    assert len(api.get("/api/campaigns").json()) == 1
