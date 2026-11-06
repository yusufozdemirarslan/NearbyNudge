"""Persistent job queue (a database table). Jobs survive restarts; running jobs are re-queued on start.

On this computer the worker polls the table. Hosted, nothing polls: `dispatcher` (set by serverless.py) sends each
queued job to Vercel Queues once its transaction is saved, and the queue runs it.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db import after_commit, iso, utcnow
from ..models import Job

#: (job id, seconds until it's due) -> sends it to the background queue. None on this computer.
dispatcher: Callable[[str, float], None] | None = None


def _dispatch_when_saved(db: Session, job: Job) -> None:
    send = dispatcher
    if send is None:
        return
    job_id = job.id
    delay = max(0.0, (job.run_after - utcnow()).total_seconds())
    after_commit(db, lambda: send(job_id, delay))


def enqueue(
    db: Session,
    *,
    kind: str,
    user_id: str,
    campaign_id: str | None = None,
    lead_id: str | None = None,
    delay_s: float = 0,
    payload: dict[str, Any] | None = None,
) -> Job:
    job = Job(
        kind=kind, user_id=user_id, campaign_id=campaign_id, lead_id=lead_id, status="queued",
        run_after=utcnow() + timedelta(seconds=delay_s), payload=payload,
    )
    db.add(job)
    db.flush()
    _dispatch_when_saved(db, job)
    return job


def claim_next(db: Session, running_by_user: dict[str, int], exclude_ids: set[str]) -> Job | None:
    """Oldest due job, preferring users with the fewest jobs running (a fair queue per user)."""
    now = utcnow()
    rows = db.scalars(
        select(Job).where(Job.status == "queued", Job.run_after <= now).order_by(Job.created_at).limit(100)
    ).all()
    rows = [j for j in rows if j.id not in exclude_ids]
    if not rows:
        return None
    # discovery first (it creates the cards users are waiting for), then fairness, then age
    rows.sort(key=lambda j: (0 if j.kind == "discover" else 1, running_by_user.get(j.user_id, 0), j.created_at))
    job = rows[0]
    job.status = "running"
    job.attempts += 1
    job.updated_at = now
    db.flush()
    return job


def finish(db: Session, job_id: str, *, status: str = "done", error: str | None = None) -> None:
    job = db.get(Job, job_id)
    if job is not None and job.status in ("running", "queued"):  # never overwrite "cancelled"
        job.status = status
        job.last_error = error
        job.updated_at = utcnow()


def requeue(db: Session, job_id: str, *, delay_s: float, count_attempt: bool = True, error: str | None = None) -> None:
    job = db.get(Job, job_id)
    if job is None or job.status not in ("running", "queued"):
        return
    job.status = "queued"
    job.run_after = utcnow() + timedelta(seconds=delay_s)
    if not count_attempt:
        job.attempts = max(0, job.attempts - 1)
    job.last_error = error
    job.updated_at = utcnow()
    _dispatch_when_saved(db, job)


def outage_began(db: Session, job_id: str, stage: str | None) -> datetime:
    """When the AI outage this job is waiting out began: its first "unavailable" since the work last moved on (to
    another `stage`) or since an account pause. The one-day give-up counts from here, not from when the job was
    queued: it may have waited out a long pause, a laptop sleep or a restart first."""
    now = utcnow()
    job = db.get(Job, job_id)
    if job is None:
        return now
    data = dict(job.payload or {})
    since = data.get("outage_since")
    if not since or data.get("outage_stage") != stage:
        since = iso(now)
        job.payload = {**data, "outage_since": since, "outage_stage": stage}
    return datetime.fromisoformat(since.replace("Z", ""))


def outage_over(db: Session, job_id: str) -> None:
    """The job is waiting on an account problem instead: a later outage starts its own day."""
    job = db.get(Job, job_id)
    if job is not None and job.payload and "outage_since" in job.payload:
        job.payload = {k: v for k, v in job.payload.items() if k not in ("outage_since", "outage_stage")}


def reset_running(db: Session) -> int:
    res = db.execute(update(Job).where(Job.status == "running").values(status="queued", run_after=utcnow()))
    return res.rowcount or 0


def cancel_for_campaign(db: Session, campaign_id: str) -> None:
    db.execute(
        update(Job).where(Job.campaign_id == campaign_id, Job.status.in_(("queued", "running"))).values(status="cancelled")
    )


def has_pending_lead_job(db: Session, lead_id: str) -> bool:
    return db.scalars(
        select(Job.id).where(Job.lead_id == lead_id, Job.status.in_(("queued", "running"))).limit(1)
    ).first() is not None
