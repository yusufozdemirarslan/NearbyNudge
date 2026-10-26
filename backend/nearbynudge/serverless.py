"""Running hosted on Vercel, where nothing runs between requests.

- Background work: each queued job is sent to Vercel Queues (`QueueDispatcher`), and Vercel runs
  `queue_worker.run_job` for it, which claims the job and runs it with the same code as the local worker.
  A job cut off by the platform's time limit is tried again (each stage saves before the next) a few times.
  A sweep sends jobs whose message went missing again, and the daily clean-up runs from there too.
- Live updates: the review desk's event stream reads changes from the database (`campaign_stream`), since the
  instance that saves a change is rarely the one holding the stream.
- Listings: the deployment carries the listings loaded at build time; each instance works on its own writable copy
  (`listings_copy`), so an area loaded on demand stays for that instance's lifetime.

On this computer none of this is used: the worker polls the jobs table and the event broker is in memory.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import iso, utcnow
from .models import AppSetting, Campaign, Job, Lead
from .pipeline import jobs
from .pipeline.events import sse
from .pipeline.worker import job_snapshot, still_needed

if TYPE_CHECKING:  # pragma: no cover
    from .pipeline.state import AppState

log = logging.getLogger("nearbynudge.serverless")

TOPIC = "nearbynudge-jobs"
#: Hosted functions stop at 300 s, so a job still "running" after this long was cut off.
STALE_RUNNING_S = 330
#: Runs of one job (cut-offs included) before it gives up
MAX_ATTEMPTS = 4
CUT_OFF_MESSAGE = "Couldn't finish: research took too long. Retry, or review without site facts."
#: A queued job this overdue lost its message (a failed send, or a removed deployment): send it again
OVERDUE_S = 15 * 60
SWEEP_EVERY_S = 60
PURGE_EVERY_S = 6 * 3600
PROBE_EVERY_S = 300
#: Live stream: how long one stream stays open (under the 300 s limit), and how often it reads the database
STREAM_SECONDS = 240
POLL_S = 1.5
#: What the browser waits before it reconnects: soon while research runs, a minute when nothing is running
ACTIVE_RETRY_MS = 1000
IDLE_RETRY_MS = 60_000
#: Changes saved this long before a read still show up in it (a transaction can commit after a later one)
OVERLAP_S = 30


# ---------- listings ----------

#: The build step packs the listings and DuckDB's extensions with zstd (backend/scripts/vercel_build.py)
PACKED = ".zst"
PACKED_EXTENSIONS = "duckdb_extensions.tar.zst"


def _partial(target: Path) -> Path:
    return target.with_name(f"{target.name}.{os.getpid()}.{threading.get_ident()}.part")


def listings_copy(settings: Settings) -> Path:
    """This instance's writable copy of the deployed listings (made once per server process: DuckDB lets only one
    process open a file). The deployment carries them packed (listings.duckdb.zst), or as they are."""
    target = settings.runtime_dir / f"listings-{os.getpid()}.duckdb"
    if target.exists():
        return target
    source = settings.listings_file
    packed = source.with_name(source.name + PACKED)
    if not source.exists() and not packed.exists():
        return target  # nothing deployed: the store starts empty and says so
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = _partial(target)
    if source.exists():
        shutil.copyfile(source, partial)
    else:
        from compression import zstd  # Python 3.14

        with zstd.open(packed, "rb") as fin, partial.open("wb") as fout:
            shutil.copyfileobj(fin, fout, 4 << 20)
    os.replace(partial, target)  # another thread that copied too ends with the same file
    return target


def duckdb_extension_dir(settings: Settings) -> Path:
    """A writable folder for DuckDB's extensions (httpfs, for loading a new area), in this instance's temporary
    folder: it starts with the ones installed at build time, and DuckDB can still download one it's missing."""
    target = settings.runtime_dir / "duckdb_extensions"
    if target.exists():
        return target
    packed = settings.data_dir / PACKED_EXTENSIONS
    bundled = settings.data_dir / "duckdb_extensions"
    if not packed.is_file() and not bundled.is_dir():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = _partial(target)
    if packed.is_file():
        import tarfile

        partial.mkdir()
        with tarfile.open(packed, "r:zst") as tar:
            tar.extractall(partial, filter="data")
        unpacked = partial / "duckdb_extensions"
    else:
        shutil.copytree(bundled, partial)
        unpacked = partial
    try:
        os.replace(unpacked, target)
    except OSError:  # another thread got there first
        pass
    shutil.rmtree(partial, ignore_errors=True)
    return target


# ---------- sending jobs to the queue ----------

class QueueDispatcher:
    """jobs.dispatcher for hosted runs: one Vercel Queues message per due job."""

    def __init__(self, client: Any = None) -> None:
        self._client: Any = client  # a vercel.queue.sync.QueueClient; made on first use (tests pass their own)
        self._lock = threading.Lock()

    def _queue(self) -> Any:
        with self._lock:
            if self._client is None:
                from vercel.queue.sync import QueueClient

                self._client = QueueClient()
            return self._client

    def __call__(self, job_id: str, delay_s: float) -> None:
        delay = min(max(0, round(delay_s)), 6 * 24 * 3600)
        try:
            self._queue().send(TOPIC, {"job_id": job_id}, delay=delay or None, retention=timedelta(days=7))
        except Exception:  # noqa: BLE001 - the sweep sends it again; the request that queued it still succeeds
            log.exception("could not send job %s to the queue", job_id)


def _send_later(job_id: str, delay_s: float) -> None:
    send = jobs.dispatcher
    if send is not None:
        send(job_id, delay_s)


# ---------- the consumer's own app state ----------

_runtime: AppState | None = None
_runtime_loop: asyncio.AbstractEventLoop | None = None
_runtime_guard = threading.Lock()


def install() -> None:
    """Hosted wiring: queued jobs go to Vercel Queues."""
    if jobs.dispatcher is None:
        jobs.dispatcher = QueueDispatcher()


async def runtime() -> AppState:
    """The app state for this instance's queue handler, built on its first message."""
    global _runtime, _runtime_loop
    loop = asyncio.get_running_loop()
    with _runtime_guard:
        if _runtime is not None and _runtime_loop is loop:
            return _runtime
        from .app import build_state
        from .pipeline.worker import Worker

        settings = get_settings()
        settings.validate_for_start()
        state = build_state(settings)
        state.broker.bind(loop)
        state.worker = Worker(state)  # never started: it only runs the jobs this handler claims
        install()
        _runtime, _runtime_loop = state, loop
        return state


# ---------- running one job ----------

@dataclass
class Claim:
    job: dict[str, Any] | None = None  # claimed: run it now
    wait_s: float | None = None  # not yet: look again after this long
    give_up: dict[str, Any] | None = None  # cut off too often: fail it


def claim_job(s: Session, job_id: str, *, now: datetime | None = None) -> Claim:
    """Claims one job for this delivery, the way the local worker claims the next one."""
    now = now or utcnow()
    job = s.get(Job, job_id)
    if job is None or job.status not in ("queued", "running"):
        return Claim()
    if job.status == "queued":
        due_in = (job.run_after - now).total_seconds()
        if due_in > 1:
            return Claim(wait_s=due_in)
    else:
        age = (now - (job.updated_at or job.created_at)).total_seconds()
        if age < STALE_RUNNING_S:
            return Claim(wait_s=STALE_RUNNING_S - age + 5)  # it may still be running elsewhere
        if job.attempts >= MAX_ATTEMPTS:
            return Claim(give_up=job_snapshot(job))
    claimed = s.execute(
        update(Job).where(Job.id == job.id, Job.status == job.status, Job.attempts == job.attempts)
        .values(status="running", attempts=Job.attempts + 1, updated_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount
    if claimed != 1:
        return Claim()  # another delivery of the same job got there first
    s.refresh(job)
    return Claim(job=job_snapshot(job)) if still_needed(s, job) else Claim()


async def handle_job_message(payload: Any) -> None:
    """One delivery from Vercel Queues: {"job_id": ...}."""
    app = await runtime()
    job_id = str((payload or {}).get("job_id") or "") if isinstance(payload, dict) else ""
    if job_id:
        await run_job_message(app, job_id)
    await maybe_sweep(app)


async def run_job_message(app: AppState, job_id: str) -> None:
    state, reason, _ = app.ai_state()
    if state != "ok" and not await _resumed_after_probe(app, reason):
        # Paused: the job stays queued and asks again later (a fresh message, so a long pause can't use up its retries)
        await asyncio.to_thread(_send_later, job_id, _pause_wait_s(app, state))
        return
    claim = await app.db.arun(lambda s: claim_job(s, job_id))
    if claim.wait_s is not None:
        await asyncio.to_thread(_send_later, job_id, claim.wait_s)
        return
    assert app.worker is not None
    if claim.give_up is not None:
        await app.worker._give_up(claim.give_up, CUT_OFF_MESSAGE)
        return
    if claim.job is not None:
        await app.worker._run_job(claim.job)


def _pause_wait_s(app: AppState, state: str) -> float:
    if state == "unconfigured":
        return 600
    until = (app.pause.state() or {}).get("until")
    if until:
        left = (datetime.fromisoformat(until.replace("Z", "")) - utcnow()).total_seconds()
        return min(max(left + 1, 5), PROBE_EVERY_S)
    return PROBE_EVERY_S


async def _resumed_after_probe(app: AppState, reason: str | None) -> bool:
    """For an account problem (credit, key, model), one instance at a time checks every few minutes whether it's fixed."""
    if reason not in ("balance", "auth", "config"):
        return False  # timed pauses end on their own; "unconfigured" needs a key
    if not await take_turn(app, "ai_probe_at", PROBE_EVERY_S):
        return False
    if await app.ai.probe():
        await asyncio.to_thread(app.pause.clear)
        log.info("AI account works again; resuming")
        return True
    return False


async def take_turn(app: AppState, key: str, every_s: float) -> bool:
    try:
        return await app.db.arun(lambda s: _take_turn(s, key, every_s))
    except IntegrityError:  # two instances made the row at once: the other one has the turn
        return False


def _take_turn(s: Session, key: str, every_s: float, *, now: datetime | None = None) -> bool:
    """True for the one caller per `every_s` (across instances) that gets to do `key`'s periodic task."""
    now = now or utcnow()
    row = s.get(AppSetting, key, with_for_update=True)
    last = row.value.get("at") if row is not None and isinstance(row.value, dict) else None
    if last and (now - datetime.fromisoformat(last.replace("Z", ""))).total_seconds() < every_s:
        return False
    if row is None:
        s.add(AppSetting(key=key, value={"at": iso(now)}))
    else:
        row.value = {"at": iso(now)}
    return True


# ---------- the sweep and the daily clean-up ----------

_last_sweep = 0.0


def stuck_jobs(s: Session, *, now: datetime | None = None) -> list[str]:
    """Jobs that should have run by now but whose message is gone: long-overdue queued ones, and running ones whose
    function was cut off after the queue stopped retrying."""
    now = now or utcnow()
    found: list[str] = []
    overdue = s.scalars(
        select(Job).where(Job.status == "queued", Job.run_after <= now - timedelta(seconds=OVERDUE_S))
        .order_by(Job.run_after).limit(50)
    ).all()
    for job in overdue:
        data = dict(job.payload or {})
        swept = data.get("swept_at")
        if swept and (now - datetime.fromisoformat(swept.replace("Z", ""))).total_seconds() < OVERDUE_S:
            continue
        job.payload = {**data, "swept_at": iso(now)}
        found.append(job.id)
    found += s.scalars(
        select(Job.id).where(Job.status == "running", Job.updated_at <= now - timedelta(seconds=STALE_RUNNING_S + OVERDUE_S))
        .limit(50)
    ).all()
    return found


async def sweep(app: AppState) -> dict[str, int]:
    ids = await app.db.arun(stuck_jobs)
    for job_id in ids:
        await asyncio.to_thread(_send_later, job_id, 0)
    purged: dict[str, int] = {}
    if await take_turn(app, "purge_at", PURGE_EVERY_S):
        from .app import purge

        purged = await asyncio.to_thread(purge, app.db)
    return {"resent": len(ids), **{f"purged_{k}": v for k, v in purged.items()}}


async def maybe_sweep(app: AppState) -> None:
    """At most once a minute per instance."""
    global _last_sweep
    if time.monotonic() - _last_sweep < SWEEP_EVERY_S:
        return
    _last_sweep = time.monotonic()
    try:
        await sweep(app)
    except Exception:  # noqa: BLE001 - the sweep is a safety net; the work it guards goes on
        log.exception("job sweep failed")


# ---------- live updates ----------

def _active(summary: dict[str, Any]) -> bool:
    return summary.get("status") in ("finding", "researching", "paused") or bool(summary.get("counts", {}).get("in_progress"))


def _changes(app: AppState, s: Session, campaign_id: str, seen: dict[str, str]) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    c = s.get(Campaign, campaign_id)
    if c is None:
        return None
    since = utcnow() - timedelta(seconds=OVERLAP_S)
    changed: list[dict[str, Any]] = []
    for lead in s.scalars(select(Lead).where(Lead.campaign_id == campaign_id, Lead.updated_at >= since)).all():
        stamp = lead.updated_at.isoformat() if lead.updated_at else ""
        if seen.get(lead.id) != stamp:
            seen[lead.id] = stamp
            changed.append(app.lead_event(s, lead))
    return changed, app.campaign_event(s, c)


async def campaign_stream(app: AppState, request: Request, campaign_id: str, workspace: str) -> StreamingResponse:
    """GET /api/campaigns/{id}/events when hosted: the same events as the local broker sends, read from the database."""
    from .api.deps import ApiError

    def load(s: Session) -> tuple[dict[str, Any], dict[str, str]] | None:
        c = s.get(Campaign, campaign_id)
        if c is None or c.user_id != workspace:
            return None
        since = utcnow() - timedelta(seconds=OVERLAP_S)
        seen = {lead.id: lead.updated_at.isoformat() for lead in s.scalars(
            select(Lead).where(Lead.campaign_id == campaign_id, Lead.updated_at >= since)).all() if lead.updated_at}
        return app.campaign_event(s, c), seen

    first = await app.db.arun(load)
    if first is None:
        raise ApiError(404, "not_found", "That campaign wasn't found.")
    snapshot, seen = first
    active = _active(snapshot)

    async def stream():
        yield f"retry: {ACTIVE_RETRY_MS if active else IDLE_RETRY_MS}\n\n"
        yield sse("campaign", snapshot)
        if not active:
            return  # nothing changes by itself; the browser checks back in a minute
        last = snapshot
        deadline = time.monotonic() + STREAM_SECONDS
        quiet_since = time.monotonic()
        while time.monotonic() < deadline:
            await asyncio.sleep(POLL_S)
            if await request.is_disconnected():
                return
            result = await app.db.arun(lambda s: _changes(app, s, campaign_id, seen))
            if result is None:
                return  # the campaign was deleted
            leads, summary = result
            for data in leads:
                yield sse("lead", data)
            changed = bool(leads)
            if summary != last:
                yield sse("campaign", summary)
                last = summary
                changed = True
            if changed:
                quiet_since = time.monotonic()
            elif time.monotonic() - quiet_since >= 15:
                yield sse("ping", {})
                quiet_since = time.monotonic()
            if not _active(summary):
                return
            await maybe_sweep(app)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
