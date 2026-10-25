"""Admin console: AI spend and balance forecast, errors, audit samples, site-owner opt-outs (AC3)."""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import schemas
from ..db import iso, utcnow
from ..models import AiCall, AppSetting, AuditVerdict, Campaign, ErrorLog, Fact, Lead, OptOut, User
from ..pipeline import serialize
from ..pipeline.state import AppState
from ..pipeline.worker import queue_counts
from ..reader import registrable_domain
from .deps import ApiError, current_user, get_app, get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])

BALANCE_KEY = "ai_balance"


def _sum_cost(db: Session, since: datetime) -> float:
    return float(db.scalar(select(func.coalesce(func.sum(AiCall.cost_usd), 0.0)).where(AiCall.created_at >= since)) or 0.0)


def overview(db: Session, app: AppState) -> dict[str, Any]:
    now = utcnow()
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    state, reason, _msg = app.ai_state()
    pause = app.pause.state() or {}
    by_skill_rows = db.execute(
        select(AiCall.skill, func.count(), func.coalesce(func.sum(AiCall.cost_usd), 0.0), func.avg(AiCall.latency_ms))
        .where(AiCall.created_at >= now - timedelta(days=30)).group_by(AiCall.skill)
    ).all()
    daily_rows = db.execute(
        select(func.date(AiCall.created_at), func.coalesce(func.sum(AiCall.cost_usd), 0.0), func.count())
        .where(AiCall.created_at >= now - timedelta(days=30)).group_by(func.date(AiCall.created_at))
    ).all()
    daily_map = {str(r[0]): (float(r[1]), int(r[2])) for r in daily_rows}
    daily = []
    for i in range(29, -1, -1):
        d = (now - timedelta(days=i)).date().isoformat()
        cost, n = daily_map.get(d, (0.0, 0))
        daily.append({"date": d, "cost": round(cost, 4), "requests": n})
    counted = db.scalar(select(func.count()).select_from(Lead).where(Lead.counted.is_(True))) or 0
    lead_cost = float(db.scalar(select(func.coalesce(func.sum(Lead.cost_usd), 0.0)).where(Lead.counted.is_(True))) or 0.0)
    # contact JSON may say kind "none"; count email/form only
    contact_rows = db.scalars(select(Lead.contact).where(Lead.counted.is_(True))).all()
    with_contact = sum(1 for c in contact_rows if c and c.get("kind") in ("email", "form"))
    audited = db.scalar(select(func.count()).select_from(AuditVerdict)) or 0
    supported = db.scalar(select(func.count()).select_from(AuditVerdict).where(AuditVerdict.verdict == "supported")) or 0
    d7 = _sum_cost(db, now - timedelta(days=7))
    bal = db.get(AppSetting, BALANCE_KEY)
    amount = as_of = None
    spent_since = 0.0
    if bal and bal.value:
        amount = float(bal.value.get("amount", 0))
        as_of = bal.value.get("as_of")
        if as_of:
            spent_since = _sum_cost(db, datetime.fromisoformat(as_of.replace("Z", "")))
    avg_daily = d7 / 7
    remaining = (amount - spent_since) if amount is not None else None
    return {
        "ai": {"state": state, "reason": reason, "since": pause.get("since"), "model": app.settings.ai_model,
               "web_search": app.web_search_state if app.settings.ai_web_search else "unavailable"},
        "spend": {
            "today": round(_sum_cost(db, day0), 4),
            "d7": round(d7, 4),
            "d30": round(_sum_cost(db, now - timedelta(days=30)), 4),
            "per_lead_avg": round(lead_cost / counted, 4) if counted else None,
            "requests_today": int(db.scalar(select(func.count()).select_from(AiCall).where(AiCall.created_at >= day0)) or 0),
            "by_skill": [{"skill": r[0], "requests": int(r[1]), "cost": round(float(r[2]), 4), "avg_latency_ms": int(r[3] or 0)}
                         for r in sorted(by_skill_rows, key=lambda r: -float(r[2]))],
            "daily": daily,
        },
        "balance": {
            "amount": amount, "as_of": as_of, "spent_since": round(spent_since, 4),
            "remaining": round(remaining, 4) if remaining is not None else None,
            "avg_daily": round(avg_daily, 4),
            "days_left": round(remaining / avg_daily, 1) if (remaining is not None and avg_daily > 0) else None,
        },
        "queue": queue_counts(db),
        "quality": {
            "audited_facts": int(audited),
            "supported_pct": round(100 * supported / audited, 1) if audited else None,
            "leads_with_contact_pct": round(100 * with_contact / counted, 1) if counted else None,
            "avg_cost_per_lead": round(lead_cost / counted, 4) if counted else None,
        },
    }


@router.get("/overview", response_model=schemas.AdminOverview)
def get_overview(_: User = Depends(current_user), db: Session = Depends(get_db, scope="function"), app: AppState = Depends(get_app)) -> dict:
    return overview(db, app)


@router.put("/balance", response_model=schemas.AdminOverview)
def set_balance(body: schemas.SetBalanceRequest, _: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
                app: AppState = Depends(get_app)) -> dict:
    row = db.get(AppSetting, BALANCE_KEY)
    value = {"amount": body.amount, "as_of": iso(utcnow())}
    if row is None:
        db.add(AppSetting(key=BALANCE_KEY, value=value))
    else:
        row.value = value
    db.flush()
    return overview(db, app)


@router.post("/resume", response_model=schemas.AdminOverview)
def resume(_: User = Depends(current_user), db: Session = Depends(get_db, scope="function"), app: AppState = Depends(get_app)) -> dict:
    app.pause.clear()
    if app.worker:
        app.worker.wake()
    return overview(db, app)


@router.get("/errors", response_model=list[schemas.ErrorEntry])
def errors(_: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> list:
    rows = db.scalars(select(ErrorLog).order_by(ErrorLog.created_at.desc()).limit(100)).all()
    return [{"id": r.id, "created_at": iso(r.created_at), "where": r.where, "message": r.message,
             "campaign_id": r.campaign_id, "lead_id": r.lead_id} for r in rows]


@router.get("/ai-calls", response_model=list[schemas.AiCallRow])
def ai_calls(limit: int = 50, _: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> list:
    rows = db.scalars(select(AiCall).order_by(AiCall.created_at.desc()).limit(max(1, min(500, limit)))).all()
    return [{"id": r.id, "created_at": iso(r.created_at), "skill": r.skill, "thinking": r.thinking,
             "prompt_tokens": r.input_tokens + r.cache_write_tokens + r.cache_read_tokens,
             "cached_tokens": r.cache_read_tokens, "completion_tokens": r.output_tokens,
             "web_search_calls": r.web_searches, "cost_usd": round(r.cost_usd, 6), "latency_ms": r.latency_ms,
             "status": "error" if r.status == "error" else "ok", "error": r.error_message} for r in rows]


@router.get("/audit/sample", response_model=list[schemas.AuditLead])
def audit_sample(n: int = 10, _: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> list:
    since = utcnow() - timedelta(days=30)
    ids = db.scalars(select(Lead.id).where(Lead.counted.is_(True), Lead.created_at >= since)).all()
    pick = random.sample(list(ids), min(len(ids), max(1, min(50, n)))) if ids else []
    out = []
    for lid in pick:
        lead = db.get(Lead, lid)
        if lead is None:
            continue
        camp = db.get(Campaign, lead.campaign_id)
        facts = db.scalars(select(Fact).where(Fact.lead_id == lid, Fact.origin == "research").order_by(Fact.n)).all()
        verdicts = {v.fact_id: v.verdict for v in db.scalars(select(AuditVerdict).where(AuditVerdict.fact_id.in_([f.id for f in facts]))).all()} if facts else {}
        subject = serialize.subjects_for(db, [lead]).get(lead.id)
        out.append({"lead_id": lead.id, "name": lead.name, "campaign_name": camp.name if camp else "",
                    "website": lead.website, "email_subject": subject,
                    "facts": [{"fact": serialize.fact_dict(f, set()), "verdict": verdicts.get(f.id)} for f in facts]})
    return out


@router.post("/audit/facts/{fact_id}", response_model=schemas.OkResponse)
def audit_fact(fact_id: str, body: schemas.AuditVerdictRequest, user: User = Depends(current_user),
               db: Session = Depends(get_db, scope="function")) -> dict:
    if db.get(Fact, fact_id) is None:
        raise ApiError(404, "not_found", "That fact wasn't found.")
    existing = db.scalars(select(AuditVerdict).where(AuditVerdict.fact_id == fact_id)).first()
    if existing:
        existing.verdict = body.verdict
        existing.reviewer_id = user.id
    else:
        db.add(AuditVerdict(fact_id=fact_id, reviewer_id=user.id, verdict=body.verdict))
    return {"ok": True}


def optout_out(o: OptOut) -> dict[str, Any]:
    return {"id": o.id, "domain": o.domain, "contact_email": o.contact_email, "note": o.note, "created_at": iso(o.created_at)}


@router.get("/optouts", response_model=list[schemas.OptOutOut])
def optouts(_: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> list:
    return [optout_out(o) for o in db.scalars(select(OptOut).order_by(OptOut.created_at.desc())).all()]


def add_optout(db: Session, app: AppState, domain: str, contact: str | None, note: str | None) -> OptOut:
    d = registrable_domain(domain.strip().lower())
    if not d or "." not in d:
        raise ApiError(422, "validation", "Enter a website domain, such as example.com.", {"domain": "Not valid."})
    row = db.scalars(select(OptOut).where(OptOut.domain == d)).first()
    if row is None:
        row = OptOut(domain=d, contact_email=(contact or "").strip()[:320] or None, note=(note or "").strip()[:1000] or None)
        db.add(row)
        db.flush()
    return row


@router.post("/optouts", response_model=schemas.OptOutOut)
def create_optout(body: schemas.CreateOptOutRequest, _: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
                  app: AppState = Depends(get_app)) -> dict:
    row = add_optout(db, app, body.domain, body.contact_email, body.note)
    db.commit()
    app.optouts.refresh()
    return optout_out(row)


@router.delete("/optouts/{optout_id}", status_code=204)
def delete_optout(optout_id: str, _: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
                  app: AppState = Depends(get_app)) -> Response:
    row = db.get(OptOut, optout_id)
    if row is None:
        raise ApiError(404, "not_found", "That opt-out wasn't found.")
    db.delete(row)
    db.commit()
    app.optouts.refresh()
    return Response(status_code=204)
