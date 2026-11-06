"""Leads: detail, edit, rewrite, approve, skip, do not contact, sending preview, undo, retry (DB2-DB4)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from .. import schemas
from ..ai.client import AIError, AIPaused, AIUnavailable
from ..models import Fact, Lead, LeadEvent, User
from ..pipeline import actions, serialize
from ..pipeline.state import AppState
from .deps import ApiError, current_user, get_app, get_db

router = APIRouter(prefix="/api", tags=["leads"])


def _owned(db: Session, lead_id: str, user: User) -> Lead:
    lead = db.get(Lead, lead_id)
    if lead is None or lead.user_id != user.id or lead.status == "replaced":
        raise ApiError(404, "not_found", "That lead wasn't found.")
    return lead


def lead_out(db: Session, lead: Lead, user: User, app: AppState) -> dict[str, Any]:
    return serialize.lead_full(db, lead, footer=app.footer_for(user), model=app.settings.ai_model)


def _result(db: Session, lead: Lead, user: User, app: AppState, action_id: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"lead": lead_out(db, lead, user, app),
                           "sending": actions.sending_today(db, user, app.settings.daily_send_cap)}
    if action_id is not None:
        out["action_id"] = action_id
    return out


def _run(fn, *args):
    try:
        return fn(*args)
    except actions.ActionError as exc:
        raise ApiError(exc.status, exc.code, exc.message) from exc


@router.get("/leads/{lead_id}", response_model=schemas.Lead)
def get_lead(lead_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
             app: AppState = Depends(get_app)) -> dict:
    return lead_out(db, _owned(db, lead_id, user), user, app)


@router.put("/leads/{lead_id}/email", response_model=schemas.Lead)
def put_email(lead_id: str, body: schemas.UpdateEmailRequest, user: User = Depends(current_user),
              db: Session = Depends(get_db, scope="function"), app: AppState = Depends(get_app)) -> dict:
    lead = _owned(db, lead_id, user)
    _run(actions.edit_email, app, db, lead, user, body.subject, body.body)
    return lead_out(db, lead, user, app)


async def _ai_action(coro):
    try:
        return await coro
    except actions.ActionError as exc:
        raise ApiError(exc.status, exc.code, exc.message) from exc
    except AIPaused as exc:
        raise ApiError(503, "ai_paused", "The AI is paused right now, so rewrites are unavailable. Nothing is lost.") from exc
    except AIUnavailable as exc:
        raise ApiError(503, "ai_paused", "The AI is busy right now. Please try the rewrite again in a minute.") from exc
    except AIError as exc:
        raise ApiError(502, "ai_error", "The rewrite didn't work this time. Your current email is unchanged.") from exc


@router.post("/leads/{lead_id}/rewrite", response_model=schemas.Lead)
async def rewrite(lead_id: str, body: schemas.RewriteRequest, request: Request, user: User = Depends(current_user),
                  app: AppState = Depends(get_app)) -> dict:
    await app.db.arun(lambda s: _owned(s, lead_id, user))
    # Cancel in the dashboard closes the request: the rewrite then isn't saved
    await _ai_action(actions.rewrite(app, lead_id, user.id, body.mode, hook_id=body.hook_id,
                                     cancelled=request.is_disconnected))
    return await app.db.arun(lambda s: lead_out(s, s.get(Lead, lead_id), user, app))


@router.post("/leads/{lead_id}/versions/{version_id}/restore", response_model=schemas.Lead)
def restore(lead_id: str, version_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
            app: AppState = Depends(get_app)) -> dict:
    lead = _owned(db, lead_id, user)
    _run(actions.restore_version, app, db, lead, version_id)
    return lead_out(db, lead, user, app)


@router.post("/leads/{lead_id}/approve", response_model=schemas.ActionResult)
def approve(lead_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
            app: AppState = Depends(get_app)) -> dict:
    lead = _owned(db, lead_id, user)
    row = _run(actions.approve, app, db, lead, user)
    return _result(db, lead, user, app, row.id)


@router.post("/leads/{lead_id}/unapprove", response_model=schemas.ActionResult)
def unapprove(lead_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
              app: AppState = Depends(get_app)) -> dict:
    lead = _owned(db, lead_id, user)
    row = _run(actions.unapprove, app, db, lead, user)
    return _result(db, lead, user, app, row.id)


@router.post("/leads/{lead_id}/skip", response_model=schemas.ActionResult)
def skip(lead_id: str, body: schemas.SkipRequest, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
         app: AppState = Depends(get_app)) -> dict:
    lead = _owned(db, lead_id, user)
    row = _run(actions.skip, app, db, lead, user, body.reason)
    if app.worker:
        app.worker.cancel_lead(lead.id)
    return _result(db, lead, user, app, row.id)


@router.post("/leads/{lead_id}/dnc", response_model=schemas.ActionResult)
def dnc(lead_id: str, body: schemas.DncRequest, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
        app: AppState = Depends(get_app)) -> dict:
    lead = _owned(db, lead_id, user)
    row = _run(actions.do_not_contact, app, db, lead, user, body.reason)
    if app.worker:
        app.worker.cancel_lead(lead.id)
    return _result(db, lead, user, app, row.id)


@router.post("/leads/{lead_id}/sent", response_model=schemas.ActionResult)
def sent(lead_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
         app: AppState = Depends(get_app)) -> dict:
    lead = _owned(db, lead_id, user)
    row = _run(actions.mark_sent, app, db, lead, user)
    return _result(db, lead, user, app, row.id)


@router.post("/leads/{lead_id}/replied", response_model=schemas.ActionResult)
def replied(lead_id: str, body: schemas.RepliedRequest, user: User = Depends(current_user),
            db: Session = Depends(get_db, scope="function"), app: AppState = Depends(get_app)) -> dict:
    lead = _owned(db, lead_id, user)
    row = _run(actions.mark_replied, app, db, lead, user, body.outcome)
    return _result(db, lead, user, app, row.id)


@router.post("/actions/{action_id}/undo", response_model=schemas.UndoResult)
def undo(action_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
         app: AppState = Depends(get_app)) -> dict:
    lead = _run(actions.undo, app, db, action_id, user)
    return _result(db, lead, user, app)


@router.post("/leads/{lead_id}/retry", response_model=schemas.Lead)
def retry(lead_id: str, body: schemas.RetryRequest, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
          app: AppState = Depends(get_app)) -> dict:
    lead = _owned(db, lead_id, user)
    _run(actions.retry, app, db, lead, body.mode)
    if app.worker:
        app.worker.wake()
    return lead_out(db, lead, user, app)


@router.post("/facts/{fact_id}/wrong", response_model=schemas.Lead)
async def wrong_fact(fact_id: str, body: schemas.WrongFactRequest, request: Request, user: User = Depends(current_user),
                     app: AppState = Depends(get_app)) -> dict:
    def check(s: Session) -> None:
        f = s.get(Fact, fact_id)
        if f is None:
            raise ApiError(404, "not_found", "That fact wasn't found.")
        _owned(s, f.lead_id, user)
    await app.db.arun(check)
    lead_id = await _ai_action(actions.wrong_fact(app, fact_id, user.id, body.note, cancelled=request.is_disconnected))
    return await app.db.arun(lambda s: lead_out(s, s.get(Lead, lead_id), user, app))


@router.post("/leads/{lead_id}/events", status_code=204)
def lead_event(lead_id: str, body: schemas.LeadEventRequest, user: User = Depends(current_user),
               db: Session = Depends(get_db, scope="function")) -> Response:
    lead = _owned(db, lead_id, user)
    db.add(LeadEvent(lead_id=lead.id, user_id=user.id, kind=body.kind))
    return Response(status_code=204)
