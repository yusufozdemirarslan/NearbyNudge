"""Persistent job queue (SQLite). Jobs survive restarts; running jobs are re-queued on start."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Job


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
