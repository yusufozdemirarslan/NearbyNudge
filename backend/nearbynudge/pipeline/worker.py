"""Background worker: runs discovery and lead jobs, a few at a time, fairly across users.

When the AI is paused (out of credit, key problem, overload) the worker stops taking jobs and
checks back periodically; queued work simply waits, so nothing is lost.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.client import AIPaused, AIUnavailable
from ..db import utcnow
from ..models import Campaign, Lead
from . import jobs, steps
from .state import AppState

log = logging.getLogger("nearbynudge.worker")

GIVE_UP_AFTER_S = 24 * 3600  # an outage pauses work; a job gives up only after a day of trying
PROBE_EVERY_S = 300


class Worker:
    def __init__(self, app: AppState):
        self.app = app
        self.concurrency = max(1, app.settings.worker_concurrency)
        self._task: asyncio.Task[None] | None = None
        self._running: dict[str, tuple[asyncio.Task[None], str, dict[str, Any]]] = {}
        self._wake = asyncio.Event()
        self._stopping = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._last_probe = 0.0

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        n = await self.app.db.arun(jobs.reset_running)
        if n:
            log.info("re-queued %d jobs that were running at shutdown", n)
        self._task = asyncio.create_task(self._run_loop(), name="nearbynudge-worker")

    async def stop(self) -> None:
        self._stopping = True
        self.wake()
        tasks = [t for t, _, _ in self._running.values()]
        for t in tasks:
            t.cancel()
        if self._task:
            self._task.cancel()
        await asyncio.gather(*tasks, *( [self._task] if self._task else []), return_exceptions=True)

    def wake(self) -> None:
        loop = self._loop
        if loop is None:
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            self._wake.set()
        else:
            loop.call_soon_threadsafe(self._wake.set)

    def _cancel_where(self, pred) -> int:
        """Cancel running jobs (thread-safe). Their database writes are guarded, so this only saves AI spend."""
        loop = self._loop
        n = 0
        for task, _uid, job in list(self._running.values()):
            if pred(job):
                n += 1
                if loop is not None:
                    loop.call_soon_threadsafe(task.cancel)
        return n

    def cancel_lead(self, lead_id: str) -> int:
        return self._cancel_where(lambda job: job.get("lead_id") == lead_id)

    def cancel_campaign(self, campaign_id: str) -> int:
        return self._cancel_where(lambda job: job.get("campaign_id") == campaign_id)

    def cancel_user(self, user_id: str) -> int:
        return self._cancel_where(lambda job: job.get("user_id") == user_id)

    async def _sleep(self, seconds: float) -> None:
        try:
            await asyncio.wait_for(self._wake.wait(), timeout=seconds)
        except TimeoutError:
            pass
        self._wake.clear()

    async def _run_loop(self) -> None:
        while not self._stopping:
            try:
                state, reason, _ = self.app.ai_state()
                if state != "ok":
                    await self._maybe_probe(reason)
                    await self._sleep(3)
                    continue
                if len(self._running) >= self.concurrency:
                    await self._sleep(1)
                    continue
                per_user: dict[str, int] = {}
                for _, uid, _job in self._running.values():
                    per_user[uid] = per_user.get(uid, 0) + 1
                exclude = set(self._running)
                job = await self.app.db.arun(lambda s: _claim(s, per_user, exclude))
                if job is None:
                    await self._sleep(2)
                    continue
                task = asyncio.create_task(self._run_job(job), name=f"job-{job['id']}")
                self._running[job["id"]] = (task, job["user_id"], job)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - the loop must keep running
                log.exception("worker loop error")
                await asyncio.sleep(2)

    async def _maybe_probe(self, reason: str | None) -> None:
        if reason not in ("balance", "auth", "config"):
            return  # timed pauses end on their own; "unconfigured" needs a key
        if time.monotonic() - self._last_probe < PROBE_EVERY_S:
            return
        self._last_probe = time.monotonic()
        if await self.app.ai.probe():
            self.app.pause.clear()
            log.info("AI account works again; resuming")

    async def _run_job(self, job: dict[str, Any]) -> None:
        job_id = job["id"]
        try:
            if job["kind"] == "discover":
                await steps.discover(self.app, job["campaign_id"])
            elif job["kind"] == "lead":
                await steps.process_lead(self.app, job["lead_id"])
            await self.app.db.arun(lambda s: jobs.finish(s, job_id))
        except AIPaused as exc:
            await self.app.db.arun(lambda s: jobs.requeue(s, job_id, delay_s=5, count_attempt=False, error=str(exc)))
        except AIUnavailable as exc:
            # Rate limits and outages pause the work rather than failing it; give up only after a day.
            if (utcnow() - job["created_at"]).total_seconds() > GIVE_UP_AFTER_S:
                await self._give_up(job, "Couldn't finish: the AI wasn't reachable for a day. Retry when it's back.")
            else:
                await self.app.db.arun(lambda s: jobs.requeue(
                    s, job_id, delay_s=self.app.settings.retry_delay_s, count_attempt=False, error=str(exc)))
        except asyncio.CancelledError:
            # stopped by a shutdown (re-queued) or by the user (the claim then sees the lead is done)
            await self.app.db.arun(lambda s: jobs.requeue(s, job_id, delay_s=0, count_attempt=False, error="stopped"))
            if self._stopping:
                raise
        except Exception as exc:  # noqa: BLE001
            self.app.log_error("pipeline", f"{job['kind']} job failed: {exc}", exc=exc,
                               campaign_id=job.get("campaign_id"), lead_id=job.get("lead_id"))
            await self._give_up(job, "Couldn't finish: something went wrong on our side. Retry, or review without site facts.")
        finally:
            self._running.pop(job_id, None)
            self.wake()

    async def _give_up(self, job: dict[str, Any], message: str) -> None:
        job_id = job["id"]

        def fn(s: Session) -> None:
            jobs.finish(s, job_id, status="failed", error=message)
            if job["kind"] == "lead" and job.get("lead_id"):
                lead = s.get(Lead, job["lead_id"])
                if lead is not None and lead.status in ("queued", "reading", "choosing", "writing", "checking"):
                    lead.status = "failed"
                    lead.error = message
                    lead.step = None
                    lead.stage_label = None
                    lead.updated_at = utcnow()
                    s.flush()
                    self.app.publish_lead(s, lead)
                    steps.maybe_finish_campaign(self.app, s, lead.campaign_id)
            elif job["kind"] == "discover" and job.get("campaign_id"):
                c = s.get(Campaign, job["campaign_id"])
                if c is not None:
                    c.status = "failed"
                    c.status_detail = "We couldn't start this campaign. Please start it again."
                    s.flush()
                    self.app.publish_campaign(s, c)
        await self.app.db.arun(fn)


def _claim(s: Session, per_user: dict[str, int], exclude: set[str]) -> dict[str, Any] | None:
    job = jobs.claim_next(s, per_user, exclude)
    if job is None:
        return None
    # skip leads that no longer need work (skipped or deleted while queued)
    if job.kind == "lead" and job.lead_id:
        lead = s.get(Lead, job.lead_id)
        if lead is None or lead.status not in ("queued", "reading", "choosing", "writing", "checking"):
            jobs.finish(s, job.id, status="cancelled")
            return None
    if job.kind == "discover" and job.campaign_id and s.get(Campaign, job.campaign_id) is None:
        jobs.finish(s, job.id, status="cancelled")
        return None
    return {"id": job.id, "kind": job.kind, "user_id": job.user_id, "campaign_id": job.campaign_id,
            "lead_id": job.lead_id, "attempts": job.attempts, "created_at": job.created_at}


def queue_counts(s: Session) -> dict[str, int]:
    from datetime import timedelta

    from sqlalchemy import func

    from ..models import Job

    rows = s.execute(select(Job.status, func.count()).group_by(Job.status)).all()
    by = {r[0]: r[1] for r in rows}
    failed_24h = s.scalar(
        select(func.count()).select_from(Job).where(Job.status == "failed", Job.updated_at >= utcnow() - timedelta(hours=24))
    ) or 0
    return {"queued": by.get("queued", 0), "running": by.get("running", 0), "failed_24h": int(failed_24h)}
