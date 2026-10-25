"""Shared API plumbing: errors, the database session, and the workspace every request works in."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator
from typing import Any

from fastapi import Depends, Request
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from ..db import iso, utcnow
from ..models import User
from ..pipeline.state import AppState
from ..security import limiter

#: The one built-in workspace. There's no sign-in: everyone who opens the app works here.
DEFAULT_WORKSPACE = "default"
#: Test servers only (NN_DEV_WORKSPACES): picks a separate workspace per test, so tests can run side by side.
DEV_WORKSPACE_COOKIE = "nn_dev_workspace"
_DEV_WORKSPACE_ID = re.compile(r"dev-[0-9a-f]{20}")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: dict[str, str] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields


def get_app(request: Request) -> AppState:
    return request.app.state.nn


def get_db(request: Request) -> Iterator[Session]:
    app: AppState = request.app.state.nn
    with app.db.session() as s:
        yield s


def dev_workspace_id(key: str) -> str:
    """The test workspace for a key: the same key always gives the same workspace."""
    return "dev-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:20]


def ensure_workspace(db: Session, workspace_id: str) -> User:
    """The workspace's row, created empty when it doesn't exist yet (safe if two requests race)."""
    user = db.get(User, workspace_id)
    if user is None:
        db.execute(insert(User).values(id=workspace_id, created_at=utcnow()).on_conflict_do_nothing(index_elements=["id"]))
        user = db.get(User, workspace_id)
    assert user is not None
    return user


def workspace_id(request: Request) -> str:
    app: AppState = request.app.state.nn
    if app.settings.dev_workspaces_enabled:
        chosen = request.cookies.get(DEV_WORKSPACE_COOKIE, "")
        if _DEV_WORKSPACE_ID.fullmatch(chosen):
            return chosen
    return DEFAULT_WORKSPACE


def current_user(request: Request, db: Session = Depends(get_db, scope="function")) -> User:
    """The workspace this request works in (always the built-in one, except on test servers)."""
    return ensure_workspace(db, workspace_id(request))


def require_onboarded(user: User = Depends(current_user)) -> User:
    if not user.profile or not (user.profile.get("sender_address") or "").strip():
        raise ApiError(409, "profile_required", "Add your sender profile, including a postal address, before starting.")
    return user


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limit(key: str, limit: int, window_s: float) -> None:
    if not limiter.allow(key, limit, window_s):
        raise ApiError(429, "rate_limited", "Too many attempts. Please wait a minute and try again.")


def user_out(user: User) -> dict[str, Any]:
    profile = user.profile or {}
    return {
        "id": user.id,
        "name": (profile.get("sender_name") or "").strip(),
        "onboarded": bool((profile.get("sender_address") or "").strip()),
        "created_at": iso(user.created_at),
    }
