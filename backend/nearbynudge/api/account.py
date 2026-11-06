"""The workspace: sender profile, preferences, usage, and "Delete all data". There is no sign-in."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import emailtext, schemas
from ..models import Campaign, User
from ..pipeline import jobs, limits
from ..pipeline.limits import month_bounds, sending_today  # noqa: F401 - month_bounds is imported from here too
from ..pipeline.state import AppState
from .deps import ApiError, current_user, ensure_workspace, get_app, get_db, user_out

router = APIRouter(prefix="/api", tags=["account"])

DEFAULT_PREFS = schemas.Preferences().model_dump()


def usage(db: Session, user: User, limit: int) -> dict[str, Any]:
    """This month's drafted leads against the allowance (kept when campaigns or all data are deleted)."""
    return limits.monthly_usage(db, user, limit)


def account_out(db: Session, user: User, app: AppState) -> dict[str, Any]:
    prefs = {**DEFAULT_PREFS, **(user.preferences or {})}
    return {
        "user": user_out(user),
        "profile": user.profile,
        "preferences": prefs,
        "usage": usage(db, user, app.settings.monthly_lead_limit),
        "sending": sending_today(db, user, app.settings.daily_send_cap),
        "footer_preview": emailtext.build_footer(user.profile) or None,
    }


@router.get("/me", response_model=schemas.MeResponse)
def me(user: User = Depends(current_user)) -> dict:
    return {"user": user_out(user)}


@router.get("/account", response_model=schemas.Account)
def get_account(user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"), app: AppState = Depends(get_app)) -> dict:
    return account_out(db, user, app)


@router.put("/account/profile", response_model=schemas.Account)
def put_profile(body: schemas.SenderProfile, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
                app: AppState = Depends(get_app)) -> dict:
    user.profile = body.model_dump()
    db.flush()
    return account_out(db, user, app)


@router.put("/account/preferences", response_model=schemas.Account)
def put_preferences(body: schemas.Preferences, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
                    app: AppState = Depends(get_app)) -> dict:
    user.preferences = body.model_dump()
    db.flush()
    return account_out(db, user, app)


@router.delete("/account", status_code=204)
def delete_all_data(body: schemas.DeleteAccountRequest, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db, scope="function")) -> Response:
    """Starts over: deletes the campaigns, leads, facts, page copies, emails, do-not-contact list, sender profile
    and preferences. The AI spend history stays (the admin console's record of money spent)."""
    if body.confirm.strip().lower() != "delete":
        raise ApiError(422, "validation", "Type delete to confirm.", {"confirm": "Doesn't match."})
    for cid in db.scalars(select(Campaign.id).where(Campaign.user_id == user.id)).all():
        jobs.cancel_for_campaign(db, cid)
    app = request.app.state.nn
    if app.worker:
        app.worker.cancel_user(user.id)
    workspace = user.id
    db.delete(user)  # the database cascades to everything the workspace owns
    db.flush()
    ensure_workspace(db, workspace)  # the same workspace, empty: the app starts at the sender profile again
    return Response(status_code=204)
