"""Hosted (serverless) running, on the test database: jobs go to the queue once saved, each queue message claims its
job, a job cut off by the platform's time limit is tried again a few times, lost jobs are swept up, and live updates
are read from the database instead of the in-memory broker."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nearbynudge import serverless
from nearbynudge.app import create_app
from nearbynudge.config import Settings
from nearbynudge.db import Database, utcnow
from nearbynudge.models import Job
from nearbynudge.pipeline import jobs
from tests.conftest import Api, ai_http_client
from tests.test_pipeline import start_campaign


@pytest.fixture
def db(settings: Settings) -> Iterator[Database]:
    database = Database(settings.database_url)
    database.create_all()
    yield database
    database.dispose()


def add_job(db: Database, **fields) -> str:
    def fn(s):
        job = Job(kind="noop", user_id="u1", status=fields.pop("status", "queued"), run_after=fields.pop("run_after", utcnow()),
                  attempts=fields.pop("attempts", 0))
        s.add(job)
        s.flush()
        for k, v in fields.items():
            setattr(job, k, v)
        return job.id
    return db.run(fn)


def job_row(db: Database, job_id: str) -> Job:
    return db.run(lambda s: s.get(Job, job_id))


# ---------- sending ----------

def test_jobs_are_sent_to_the_queue_once_saved(db: Database, monkeypatch):
    sent: list[tuple[str, float]] = []
    monkeypatch.setattr(jobs, "dispatcher", lambda job_id, delay: sent.append((job_id, delay)))
    job_id = db.run(lambda s: jobs.enqueue(s, kind="noop", user_id="u1", delay_s=30).id)
    assert [j for j, _ in sent] == [job_id] and 28 <= sent[0][1] <= 30

    def rolled_back(s):
        jobs.enqueue(s, kind="noop", user_id="u1")
        raise RuntimeError("the request failed")
    with pytest.raises(RuntimeError):
        db.run(rolled_back)
    assert len(sent) == 1  # never saved, never sent

    def retry(s):
        s.get(Job, job_id).status = "running"
        jobs.requeue(s, job_id, delay_s=60)
    db.run(retry)
    assert sent[-1][0] == job_id and 58 <= sent[-1][1] <= 60

    db.run(lambda s: jobs.finish(s, job_id))
    assert len(sent) == 2  # finishing sends nothing


def test_without_a_dispatcher_nothing_is_sent(db: Database):
    assert jobs.dispatcher is None  # on this computer the worker polls the table instead
    assert job_row(db, db.run(lambda s: jobs.enqueue(s, kind="noop", user_id="u1").id)).status == "queued"


def test_the_queue_dispatcher_sends_one_message_per_job():
    pytest.importorskip("vercel.queue")
    from vercel.queue.devserver import embedded_queue_dev_server

    with embedded_queue_dev_server() as server:
        dispatcher = serverless.QueueDispatcher(client=server.get_sync_client())
        dispatcher("job-now", 0)
        dispatcher("job-later", 3600)
        received = []
        for delivery in server.get_sync_client().poll(serverless.TOPIC, "probe", limit=10):
            with delivery as message:
                received.append(message.payload)
        assert received == [{"job_id": "job-now"}]  # the delayed one isn't visible yet


def test_a_failed_send_does_not_fail_the_request(caplog):
    class Broken:
        def send(self, *a, **kw):
            raise OSError("queue unreachable")
    serverless.QueueDispatcher(client=Broken())("job-1", 0)
    assert "could not send job job-1" in caplog.text


def test_the_subscriber_is_registered_for_the_job_topic():
    vq = pytest.importorskip("vercel.queue")
    from nearbynudge import queue_worker

    subs = [s for s in vq.get_subscriptions() if s.topic == serverless.TOPIC]
    assert queue_worker.TOPIC == serverless.TOPIC
    assert len(subs) == 1, vq.get_subscriptions()
    # a few jobs at once (the AI's rate limit), and a cut-off message isn't retried forever
    assert subs[0].max_concurrency == 4 and subs[0].max_attempts == 6
    assert subs[0].consumer_group  # stable: derived from the handler's name


# ---------- claiming ----------

def test_claiming_a_job_message(db: Database):
    now = utcnow()
    due = add_job(db)
    claim = db.run(lambda s: serverless.claim_job(s, due))
    assert claim.job is not None and claim.job["id"] == due and claim.job["attempts"] == 1
    assert job_row(db, due).status == "running"

    # a second delivery while it runs waits until it would count as cut off
    again = db.run(lambda s: serverless.claim_job(s, due))
    assert again.job is None and serverless.STALE_RUNNING_S - 5 <= again.wait_s <= serverless.STALE_RUNNING_S + 5

    later = add_job(db, run_after=now + timedelta(seconds=120))
    assert 110 <= db.run(lambda s: serverless.claim_job(s, later)).wait_s <= 120
    assert job_row(db, later).status == "queued"

    cut_off = add_job(db, status="running", attempts=1, updated_at=now - timedelta(seconds=serverless.STALE_RUNNING_S + 10))
    retried = db.run(lambda s: serverless.claim_job(s, cut_off))
    assert retried.job is not None and retried.job["attempts"] == 2

    worn_out = add_job(db, status="running", attempts=serverless.MAX_ATTEMPTS,
                       updated_at=now - timedelta(seconds=serverless.STALE_RUNNING_S + 10))
    gave_up = db.run(lambda s: serverless.claim_job(s, worn_out))
    assert gave_up.give_up is not None and gave_up.give_up["id"] == worn_out and gave_up.job is None

    done = add_job(db, status="done")
    for job_id in (done, "no-such-job"):
        nothing = db.run(lambda s, j=job_id: serverless.claim_job(s, j))
        assert nothing.job is None and nothing.wait_s is None and nothing.give_up is None


def test_the_sweep_resends_lost_jobs_once_in_a_while(db: Database):
    now = utcnow()
    overdue = add_job(db, run_after=now - timedelta(seconds=serverless.OVERDUE_S + 60))
    add_job(db, run_after=now - timedelta(seconds=30))  # waiting its turn in the queue: not lost
    cut_off = add_job(db, status="running", updated_at=now - timedelta(seconds=serverless.STALE_RUNNING_S + serverless.OVERDUE_S + 60))
    add_job(db, status="running", updated_at=now)
    assert set(db.run(lambda s: serverless.stuck_jobs(s, now=now))) == {overdue, cut_off}
    soon = db.run(lambda s: serverless.stuck_jobs(s, now=now + timedelta(seconds=60)))
    assert overdue not in soon and cut_off in soon  # sent again only after another wait
    assert overdue in db.run(lambda s: serverless.stuck_jobs(s, now=now + timedelta(seconds=serverless.OVERDUE_S + 1)))


def test_periodic_tasks_take_turns(db: Database):
    now = utcnow()
    assert db.run(lambda s: serverless._take_turn(s, "purge_at", 3600, now=now)) is True
    assert db.run(lambda s: serverless._take_turn(s, "purge_at", 3600, now=now + timedelta(seconds=60))) is False
    assert db.run(lambda s: serverless._take_turn(s, "purge_at", 3600, now=now + timedelta(seconds=3601))) is True


# ---------- a campaign run by queue messages ----------

class NotGone:
    async def is_disconnected(self) -> bool:
        return False


@pytest.fixture
def queued(settings: Settings, fake_ai, monkeypatch) -> Iterator[tuple[Api, list[tuple[str, float]]]]:
    """The app with its polling worker off and a recording queue: each job sent lands in the list."""
    sent: list[tuple[str, float]] = []
    monkeypatch.setattr(jobs, "dispatcher", lambda job_id, delay: sent.append((job_id, delay)))
    app = create_app(settings.model_copy(update={"worker_enabled": False}), ai_http_client=ai_http_client(fake_ai))
    with TestClient(app, base_url="http://localhost:8000") as client:
        yield Api(client), sent


def run_queue(api: Api, sent: list[tuple[str, float]], limit: int = 200) -> int:
    """Delivers every sent message, as Vercel Queues would, until none are left."""
    state = api.c.app.state.nn
    delivered = 0
    while sent and delivered < limit:
        job_id, delay = sent.pop(0)
        assert delay < 2, "a job waited for a later time in a test that has no outages"
        api.c.portal.call(serverless.run_job_message, state, job_id)
        delivered += 1
    assert not sent
    return delivered


def test_a_campaign_runs_entirely_through_queue_messages(queued):
    api, sent = queued
    api.onboard()
    _, camp = start_campaign(api)
    assert len(sent) == 1  # the discovery job, sent when the campaign was saved
    delivered = run_queue(api, sent)
    final = api.get(f"/api/campaigns/{camp['id']}").json()
    assert final["status"] == "done", final
    assert delivered >= 1 + camp["lead_target"]
    leads = api.get(f"/api/campaigns/{camp['id']}/leads").json()
    assert sum(ld["status"] in ("ready", "needs_review") for ld in leads) >= 1
    assert all(job.status in ("done", "cancelled", "failed") for job in api.c.app.state.nn.db.run(lambda s: s.query(Job).all()))


def test_a_paused_ai_keeps_the_job_waiting(queued, monkeypatch):
    api, sent = queued
    api.onboard()
    start_campaign(api)
    state = api.c.app.state.nn
    state.pause.pause("rate_limited", seconds=120)
    job_id, _ = sent.pop(0)
    api.c.portal.call(serverless.run_job_message, state, job_id)
    assert sent and sent[0][0] == job_id and 100 <= sent[0][1] <= 121  # asked again when the pause ends
    assert job_row(state.db, job_id).status == "queued"


def collect(response) -> str:
    async def read() -> str:
        parts = []
        async for chunk in response.body_iterator:
            parts.append(chunk if isinstance(chunk, str) else chunk.decode())
        return "".join(parts)
    return read


def test_live_updates_come_from_the_database(queued, monkeypatch):
    api, sent = queued
    monkeypatch.setattr(serverless, "POLL_S", 0.05)
    monkeypatch.setattr(serverless, "STREAM_SECONDS", 20)
    api.onboard()
    _, camp = start_campaign(api)
    state = api.c.app.state.nn
    workspace = "default"
    response = api.c.portal.call(serverless.campaign_stream, state, NotGone(), camp["id"], workspace)
    future = api.c.portal.start_task_soon(collect(response))
    run_queue(api, sent)  # research runs while the stream is open
    text = future.result(timeout=60)
    assert text.startswith(f"retry: {serverless.ACTIVE_RETRY_MS}\n\n")
    assert "event: campaign" in text and "event: lead" in text
    assert '"status":"done"' in text  # the stream ends once research has finished

    idle = api.c.portal.call(serverless.campaign_stream, state, NotGone(), camp["id"], workspace)
    idle_text = api.c.portal.call(collect(idle))
    assert idle_text.startswith(f"retry: {serverless.IDLE_RETRY_MS}\n\n") and idle_text.count("event: campaign") == 1

    with pytest.raises(Exception, match="wasn't found"):
        api.c.portal.call(serverless.campaign_stream, state, NotGone(), camp["id"], "someone-else")


# ---------- listings ----------

def test_each_instance_gets_its_own_copy_of_the_listings(settings: Settings, tmp_path: Path, monkeypatch):
    runtime = tmp_path / "runtime"
    monkeypatch.setattr(Settings, "runtime_dir", property(lambda self: runtime))
    hosted = settings.model_copy(update={"serverless": True})
    copy = serverless.listings_copy(hosted)
    assert copy == runtime / f"listings-{os.getpid()}.duckdb"
    assert copy.read_bytes() == hosted.listings_file.read_bytes()
    os.utime(copy, (1, 1))
    assert serverless.listings_copy(hosted) == copy and copy.stat().st_mtime == 1  # made once per instance
    # the extensions installed at build time are copied where DuckDB may also add one
    bundled = hosted.data_dir / "duckdb_extensions" / "v2.0.0" / "linux_amd64"
    bundled.mkdir(parents=True)
    (bundled / "httpfs.duckdb_extension").write_bytes(b"ext")
    ext = serverless.duckdb_extension_dir(hosted)
    assert ext == runtime / "duckdb_extensions"
    assert (ext / "v2.0.0" / "linux_amd64" / "httpfs.duckdb_extension").read_bytes() == b"ext"
    assert serverless.duckdb_extension_dir(hosted) == ext  # copied once


def test_packed_listings_and_extensions_unpack_once(settings: Settings, tmp_path: Path, monkeypatch):
    """The build step packs them with zstd (scripts/vercel_build.py); each instance unpacks its own copy."""
    import tarfile
    from compression import zstd

    runtime = tmp_path / "runtime"
    monkeypatch.setattr(Settings, "runtime_dir", property(lambda self: runtime))
    hosted = settings.model_copy(update={"serverless": True})
    raw = hosted.listings_file.read_bytes()
    with zstd.open(hosted.listings_file.with_name("listings.duckdb.zst"), "wb") as fout:
        fout.write(raw)
    hosted.listings_file.unlink()
    copy = serverless.listings_copy(hosted)
    assert copy.read_bytes() == raw and not list(runtime.glob("*.part"))

    ext_src = tmp_path / "ext" / "duckdb_extensions" / "v2.0.0" / "linux_amd64"
    ext_src.mkdir(parents=True)
    (ext_src / "httpfs.duckdb_extension").write_bytes(b"packed ext")
    with tarfile.open(hosted.data_dir / serverless.PACKED_EXTENSIONS, "w:zst") as tar:
        tar.add(tmp_path / "ext" / "duckdb_extensions", arcname="duckdb_extensions")
    ext = serverless.duckdb_extension_dir(hosted)
    assert (ext / "v2.0.0" / "linux_amd64" / "httpfs.duckdb_extension").read_bytes() == b"packed ext"
    assert not list(runtime.glob("*.part"))

    # the unpacked store answers like the original
    from nearbynudge.listings import ListingsStore

    store = ListingsStore(copy)
    try:
        assert store.covers(38.8816, -77.0910, 5)
    finally:
        store.close()
