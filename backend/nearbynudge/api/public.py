"""Public endpoints (status, health, site-owner opt-out) and the test-only workspace switch."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from .. import __version__, schemas
from ..pipeline.state import AppState
from .admin import add_optout
from .deps import (
    DEV_WORKSPACE_COOKIE,
    ApiError,
    client_ip,
    dev_workspace_id,
    ensure_workspace,
    get_app,
    get_db,
    is_email,
    rate_limit,
    user_out,
)

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/health", response_model=schemas.HealthResponse)
def health() -> dict:
    return {"ok": True, "version": __version__}


@router.get("/status", response_model=schemas.SystemStatus)
def status(app: AppState = Depends(get_app)) -> dict:
    state, _reason, message = app.ai_state()
    return {"ai_state": state, "ai_name": app.settings.ai_display_name, "ai_model": app.settings.ai_model, "message": message}


@router.post("/public/optout", response_model=schemas.OkResponse)
def public_optout(body: schemas.PublicOptOutRequest, request: Request, db: Session = Depends(get_db, scope="function"),
                  app: AppState = Depends(get_app)) -> dict:
    rate_limit(f"optout:{client_ip(request)}", 5, 3600)
    email = body.email.strip().lower()
    if not is_email(email):
        raise ApiError(422, "validation", "Enter an email address we can reach you at.", {"email": "Not valid."})
    add_optout(db, app, body.domain, email, body.note)
    db.commit()
    app.optouts.refresh()
    return {"ok": True, "message": "Thanks. NearbyNudgeBot will stop reading this site within 2 business days, usually right away."}


dev_router = APIRouter(prefix="/api/dev", tags=["dev"])

#: The complete sender profile a test workspace starts with.
TEST_PROFILE = {"sender_title": "", "sender_company": "Test Agency", "sender_address": "123 Example St, Arlington, VA 22201",
                "default_tone": "professional", "timezone": "America/New_York"}


@dev_router.post("/workspace", response_model=schemas.MeResponse)
def dev_workspace(body: schemas.DevWorkspaceRequest, response: Response, db: Session = Depends(get_db, scope="function"),
                  app: AppState = Depends(get_app)) -> dict:
    """Test servers only (NN_DEV_WORKSPACES=1, never in the real app): later requests from this browser use the
    separate workspace for `key`, made on first use. With onboarded (the default) it gets the test sender
    profile if it has none, so tests start on the campaigns page."""
    if not app.settings.dev_workspaces_enabled:
        raise ApiError(404, "not_found", "That wasn't found.")
    wid = dev_workspace_id(body.key)
    user = ensure_workspace(db, wid)
    if body.onboarded and not user.profile:
        user.profile = {"sender_name": body.name or "Test Sender", **TEST_PROFILE}
        db.flush()
    response.set_cookie(DEV_WORKSPACE_COOKIE, wid, httponly=True, samesite="lax", secure=app.settings.secure_cookies, path="/")
    return {"user": user_out(user)}
