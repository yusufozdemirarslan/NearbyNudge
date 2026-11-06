"""Database engine and session helpers (SQLAlchemy 2).

On this computer the app uses a SQLite file in WAL mode; hosted, it uses Postgres (Neon). The code is the same for
both: the few places that differ (connection settings, an insert that tolerates a race, request-at-a-time locks) are
here and in `serialized`.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any, TypeVar

from sqlalchemy import String, create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

T = TypeVar("T")
log = logging.getLogger("nearbynudge.db")


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    """Naive UTC timestamp (SQLite stores no time zone; we treat all stored times as UTC)."""
    return datetime.now(UTC).replace(tzinfo=None)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt.replace(microsecond=0).isoformat() + "Z"


def new_id() -> str:
    return uuid.uuid4().hex


@compiles(String, "postgresql")
def _postgres_string(type_: String, compiler: Any, **kw: Any) -> str:
    """Text columns are unbounded on Postgres, as they always were on SQLite (which never enforced the lengths)."""
    return "TEXT"


class Database:
    def __init__(self, url: str):
        connect_args: dict[str, Any] = {}
        pool: dict[str, Any] = {}
        if url.startswith("sqlite"):
            connect_args = {"check_same_thread": False, "timeout": 30}
            pool = {"pool_size": 20, "max_overflow": 30, "pool_timeout": 60}
        elif url.startswith("postgresql"):
            # Hosted Postgres sits behind a connection pooler: no server-side prepared statements, and a small pool
            # per server instance whose connections are checked and renewed before the pooler drops them.
            connect_args = {"prepare_threshold": None, "connect_timeout": 15}
            pool = {"pool_size": 5, "max_overflow": 10, "pool_timeout": 30, "pool_recycle": 240}
        self.engine: Engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True, **pool)
        self.dialect = self.engine.dialect.name  # "sqlite" | "postgresql"
        if self.dialect == "sqlite":
            event.listen(self.engine, "connect", _sqlite_pragmas)
        self.SessionLocal = sessionmaker(bind=self.engine, expire_on_commit=False)
        event.listen(self.SessionLocal, "after_commit", _run_after_commit)
        event.listen(self.SessionLocal, "after_transaction_end", _drop_after_commit)

    def create_all(self) -> None:
        from . import models  # noqa: F401  (registers tables)

        if self.dialect == "postgresql":
            # Several server instances can start at once: one creates the tables while the others wait.
            with self.engine.begin() as conn:
                conn.execute(text("SELECT pg_advisory_xact_lock(hashtext('nearbynudge:schema'))"))
                Base.metadata.create_all(conn)
            return
        Base.metadata.create_all(self.engine)

    @contextmanager
    def session(self) -> Iterator[Session]:
        s = self.SessionLocal()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    def run(self, fn: Callable[[Session], T]) -> T:
        with self.session() as s:
            return fn(s)

    async def arun(self, fn: Callable[[Session], T]) -> T:
        """Run a short database function in a worker thread (for async code)."""
        return await asyncio.to_thread(self.run, fn)

    def dispose(self) -> None:
        self.engine.dispose()


_AFTER_COMMIT = "nn_after_commit"


def after_commit(s: Session, fn: Callable[[], None]) -> None:
    """Run fn once this session's transaction is saved; drop it if the transaction ends any other way.

    Live updates use this, so a browser that reloads a lead when it hears about a change always gets
    the new version (another connection can't see a change before its commit).
    """
    s.info.setdefault(_AFTER_COMMIT, []).append(fn)


def _run_after_commit(s: Session) -> None:
    for fn in s.info.pop(_AFTER_COMMIT, ()):
        try:
            fn()
        except Exception:  # one failed listener mustn't stop the others (the data is already saved)
            log.exception("after-commit callback failed")


def _drop_after_commit(s: Session, transaction: Any) -> None:
    if transaction.parent is None:  # the outermost transaction ended without a commit
        s.info.pop(_AFTER_COMMIT, None)


_PROCESS_LOCKS: dict[str, threading.Lock] = {}
_PROCESS_LOCKS_GUARD = threading.Lock()


@contextmanager
def serialized(s: Session, name: str) -> Iterator[None]:
    """Lets one request at a time through a check-then-write step called `name` (a daily cap, a plan, a list).

    On Postgres it's a database lock held until this session's transaction ends, so every server instance takes its
    turn; on SQLite (one server process) it's a lock in this process. Commit inside the block, or soon after it."""
    if s.get_bind().dialect.name == "postgresql":
        s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:name))"), {"name": f"nearbynudge:{name}"})
        yield
        return
    with _PROCESS_LOCKS_GUARD:
        lock = _PROCESS_LOCKS.setdefault(name, threading.Lock())
    with lock:
        yield


def _sqlite_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=30000")
    cur.close()
