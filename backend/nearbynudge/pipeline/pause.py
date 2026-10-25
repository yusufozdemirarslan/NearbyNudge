"""Pause and resume all AI work, persisted so a restart keeps the state (PRD: pause and resume without loss)."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta

from ..ai.client import PauseControl
from ..db import Database, iso, utcnow
from ..models import AppSetting

log = logging.getLogger("nearbynudge.pause")

KEY = "ai_pause"

MESSAGES = {
    "balance": "Research paused because the AI account is out of credit. We'll resume automatically once it's topped up, and nothing is lost.",
    "auth": "Research paused because the AI key isn't working. An admin needs to check it; nothing is lost.",
    "rate_limited": "Research paused for a moment because the AI is busy. We'll resume automatically, and nothing is lost.",
    "down": "Research paused. We'll resume automatically, and nothing is lost.",
    "unconfigured": "Research is off until an admin adds the AI key.",
    "config": "Research paused because the AI model or settings aren't available to this key. An admin needs to check them; nothing is lost.",
}


class DbPause(PauseControl):
    def __init__(self, db: Database):
        self.db = db
        self._lock = threading.Lock()
        self._state: dict | None = None
        self._loaded = False

    def _load(self) -> None:
        if self._loaded:
            return
        def fn(s):
            row = s.get(AppSetting, KEY)
            return dict(row.value) if row and row.value else None
        self._state = self.db.run(fn)
        self._loaded = True

    def _save(self) -> None:
        state = self._state
        def fn(s):
            row = s.get(AppSetting, KEY)
            if row is None:
                s.add(AppSetting(key=KEY, value=state))
            else:
                row.value = state
        self.db.run(fn)

    def pause(self, reason: str, *, seconds: float | None) -> None:
        with self._lock:
            self._load()
            now = utcnow()
            until = (now + timedelta(seconds=seconds)) if seconds else None
            current = self._state or {}
            # an account problem (balance, key, model) stays until it is cleared; a brief pause can't replace it
            if current.get("reason") in ("balance", "auth", "config") and reason not in ("balance", "auth", "config"):
                return
            self._state = {
                "reason": reason,
                "since": current.get("since") if current.get("reason") == reason else iso(now),
                "until": iso(until) if until else None,
            }
            self._save()
        log.warning("AI work paused: %s (for %s)", reason, f"{seconds:.0f}s" if seconds else "until cleared")

    def clear(self) -> None:
        with self._lock:
            self._load()
            if self._state is None:
                return
            self._state = None
            self._save()
        log.info("AI work resumed")

    def state(self) -> dict | None:
        """The active pause, or None. Timed pauses expire on their own."""
        with self._lock:
            self._load()
            st = self._state
            if not st:
                return None
            until = st.get("until")
            if until and _parse(until) <= utcnow():
                self._state = None
                self._save()
                return None
            return dict(st)

    def paused(self) -> tuple[bool, str | None]:
        st = self.state()
        return (st is not None, st.get("reason") if st else None)


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", ""))
