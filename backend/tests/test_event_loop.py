"""Database writes made while AI work runs happen off the event loop, so a write that waits for another
writer's lock can't stall every page and live update meanwhile."""

from __future__ import annotations

import asyncio
import threading
import time

import pytest

from nearbynudge.ai.client import AIUnavailable, CallContext
from tests.conftest import Api
from tests.fake_ai import FakeAI
from tests.test_pipeline import start_campaign
from tests.test_units import Pause, _client

SLOW_WRITE_S = 0.5  # a write held up by another writer


async def test_recording_an_ai_pause_doesnt_hold_up_other_work():
    class SlowPause(Pause):
        def pause(self, reason, *, seconds):
            time.sleep(SLOW_WRITE_S)
            super().pause(reason, seconds=seconds)

    fake = FakeAI()
    pause = SlowPause()
    ai = _client(fake, pause=pause)
    fake.force(429, body={"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}})
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    task = asyncio.create_task(ticker())
    try:
        with pytest.raises(AIUnavailable):
            await ai.create(CallContext(skill="planner"), system="# NearbyNudge Planner",
                            messages=[{"role": "user", "content": "hi"}])
    finally:
        task.cancel()
        await ai.aclose()
    assert [reason for reason, _ in pause.calls] == ["rate_limited"]
    assert ticks >= 20, f"the event loop ran only {ticks} times while the pause was saved"


def test_a_failing_job_logs_its_error_without_holding_up_the_server(api: Api, monkeypatch):
    from nearbynudge.pipeline import steps

    app = api.c.app.state.nn
    writing = threading.Event()
    log_error = app.log_error

    def slow_log_error(*args, **kwargs):
        writing.set()
        time.sleep(SLOW_WRITE_S)
        log_error(*args, **kwargs)

    async def broken(*_args, **_kwargs):
        raise RuntimeError("something unexpected")

    monkeypatch.setattr(app, "log_error", slow_log_error)
    monkeypatch.setattr(steps, "process_lead", broken)
    api.onboard()
    start_campaign(api, answer="no")
    assert writing.wait(30), "no lead job failed"
    started = time.monotonic()
    assert api.get("/api/health").status_code == 200
    assert time.monotonic() - started < SLOW_WRITE_S / 2, "the server waited for the error log"
