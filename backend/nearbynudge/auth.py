"""Sign-in for the one account.

- The password is stored only as a scrypt hash (NN_LOGIN_PASSWORD_HASH); `hash_password` makes one.
- A signed-in browser holds a session cookie signed with NN_SESSION_SECRET. The signing key also covers the password
  hash, so changing the password signs every browser out.
- Wrong passwords are counted in the database (every server instance sees the same count): a few from one address,
  or many from everywhere, and sign-in waits for a while.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .db import utcnow
from .models import LoginAttempt

if TYPE_CHECKING:  # pragma: no cover
    from .config import Settings

SESSION_COOKIE = "nn_session"

# scrypt costs: 16 MiB of memory and about 50 ms per check
_N, _R, _P, _DKLEN = 2**14, 8, 1, 32

#: Failed attempts allowed in WINDOW: from one address, and from all addresses together
WINDOW = timedelta(minutes=15)
PER_CLIENT_FAILURES = 5
ALL_FAILURES = 50


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ---------- passwords ----------

def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """'scrypt:N:r:p:salt:hash' (no "$", so the value is safe in .env files and shells)."""
    if not password:
        raise ValueError("The password is empty")
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt:{_N}:{_R}:{_P}:{_b64(salt)}:{_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        kind, n, r, p, salt, digest = encoded.strip().split(":")
        n_i, r_i, p_i = int(n), int(r), int(p)
        expected = _unb64(digest)
        if kind != "scrypt" or not (2 <= n_i <= 2**17 and 1 <= r_i <= 16 and 1 <= p_i <= 4 and 16 <= len(expected) <= 64):
            return False
        actual = hashlib.scrypt(password.encode("utf-8"), salt=_unb64(salt), n=n_i, r=r_i, p=p_i, dklen=len(expected),
                                maxmem=256 * n_i * r_i * p_i + 2**20)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def same_login(given: str, expected: str) -> bool:
    """Compares sign-in names without case and in constant time."""
    return hmac.compare_digest(given.strip().lower().encode("utf-8"), expected.strip().lower().encode("utf-8"))


# ---------- sessions ----------

def _key(settings: Settings) -> bytes:
    return hmac.new(settings.session_secret.encode("utf-8"),
                    b"nn-session\x00" + settings.login_password_hash.strip().encode("utf-8"), hashlib.sha256).digest()


def _sign(settings: Settings, body: str) -> str:
    return _b64(hmac.new(_key(settings), body.encode("ascii"), hashlib.sha256).digest())


def session_seconds(settings: Settings) -> int:
    return max(300, int(settings.session_days * 86400))


def make_session(settings: Settings, *, now: float | None = None) -> str:
    issued = int(time.time() if now is None else now)
    claims = {"sub": settings.login_email.strip().lower(), "iat": issued, "exp": issued + session_seconds(settings)}
    body = _b64(json.dumps(claims, separators=(",", ":")).encode("utf-8"))
    return f"{body}.{_sign(settings, body)}"


def session_valid(settings: Settings, token: str | None, *, now: float | None = None) -> bool:
    if not settings.login_enabled or not token or token.count(".") != 1:
        return False
    body, sig = token.split(".")
    try:
        if not hmac.compare_digest(sig.encode("ascii"), _sign(settings, body).encode("ascii")):
            return False
        claims = json.loads(_unb64(body))
    except (ValueError, UnicodeError):
        return False
    at = time.time() if now is None else now
    return (isinstance(claims, dict) and claims.get("sub") == settings.login_email.strip().lower()
            and isinstance(claims.get("exp"), int) and isinstance(claims.get("iat"), int)
            and claims["iat"] <= at + 60 and at < claims["exp"])


def session_cookie(settings: Settings, token: str) -> str:
    cookie = f"{SESSION_COOKIE}={token}; Path=/; Max-Age={session_seconds(settings)}; HttpOnly; SameSite=Lax"
    return cookie + ("; Secure" if settings.secure_cookies else "")


def cleared_cookie(settings: Settings) -> str:
    cookie = f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
    return cookie + ("; Secure" if settings.secure_cookies else "")


# ---------- throttle ----------

def client_key(settings: Settings, address: str) -> str:
    """A keyed hash of the address: the database never stores where an attempt came from."""
    secret = (settings.session_secret or "nearbynudge").encode("utf-8")
    return hmac.new(secret, b"nn-client\x00" + address.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def wait_seconds(s: Session, client: str, *, now: datetime | None = None) -> int:
    """How long this address must wait before trying again (0: it may try now)."""
    now = now or utcnow()
    since = now - WINDOW
    failures = s.scalars(
        select(LoginAttempt.created_at)
        .where(LoginAttempt.client == client, LoginAttempt.ok.is_(False), LoginAttempt.created_at >= since)
        .order_by(LoginAttempt.created_at.desc()).limit(PER_CLIENT_FAILURES)
    ).all()
    if len(failures) >= PER_CLIENT_FAILURES:
        return max(1, int((failures[-1] + WINDOW - now).total_seconds()) + 1)
    everywhere = s.scalar(
        select(func.count()).select_from(LoginAttempt).where(LoginAttempt.ok.is_(False), LoginAttempt.created_at >= since)
    ) or 0
    return 60 if everywhere >= ALL_FAILURES else 0


def record_attempt(s: Session, client: str, ok: bool) -> None:
    if ok:  # a right password starts this address over
        s.execute(delete(LoginAttempt).where(LoginAttempt.client == client, LoginAttempt.ok.is_(False)))
    s.add(LoginAttempt(client=client, ok=ok))


def purge_attempts(s: Session, *, now: datetime | None = None) -> int:
    cutoff = (now or utcnow()) - timedelta(days=1)
    return s.execute(delete(LoginAttempt).where(LoginAttempt.created_at < cutoff)).rowcount or 0
