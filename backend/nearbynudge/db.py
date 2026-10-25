"""Database engine and session helpers (SQLite in WAL mode, SQLAlchemy 2)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any, TypeVar

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
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


class Database:
    def __init__(self, url: str):
        connect_args: dict[str, Any] = {}
        if url.startswith("sqlite"):
            connect_args = {"check_same_thread": False, "timeout": 30}
        pool = {"pool_size": 20, "max_overflow": 30, "pool_timeout": 60} if url.startswith("sqlite") else {}
        self.engine: Engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True, **pool)
        if url.startswith("sqlite"):
            event.listen(self.engine, "connect", _sqlite_pragmas)
        self.SessionLocal = sessionmaker(bind=self.engine, expire_on_commit=False)
        event.listen(self.SessionLocal, "after_commit", _run_after_commit)
        event.listen(self.SessionLocal, "after_transaction_end", _drop_after_commit)

    def create_all(self) -> None:
        from . import models  # noqa: F401  (registers tables)

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


def _sqlite_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=30000")
    cur.close()
