"""CSRF protection and simple rate limits. (There is no sign-in: see deps.current_user.)"""

from __future__ import annotations

import hmac
import secrets
import threading
import time

CSRF_COOKIE = "nn_csrf"
CSRF_HEADER = "x-csrf-token"


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


# ---------- CSRF (double submit) ----------

def csrf_ok(cookie_value: str | None, header_value: str | None) -> bool:
    if not cookie_value or not header_value:
        return False
    return hmac.compare_digest(cookie_value, header_value)


# ---------- rate limiting ----------

class RateLimiter:
    """In-memory sliding window limiter keyed by an arbitrary string (single-process app)."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_s: float) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < window_s]
            if len(hits) >= limit:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            if len(self._hits) > 50_000:  # keep memory bounded
                self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] < 3600}
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()
