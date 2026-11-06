"""Sent screen, do-not-contact list, numbers (DB3, DB4, DB5)."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import schemas
from ..db import iso
from ..models import Campaign, DncEntry, Lead, User
from ..listings.keys import host_of
from ..pipeline import serialize, steps
from ..pipeline.actions import sending_today, user_tz
from ..pipeline.state import AppState
from ..reader import is_domain
from .account import usage
from .campaigns import csv_safe
from .deps import ApiError, current_user, get_app, get_db, is_email

router = APIRouter(prefix="/api", tags=["sent", "dnc", "stats"])


# ---------- sent ----------

@router.get("/sent", response_model=schemas.SentResponse)
def sent_list(status: str = "all", user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
              app: AppState = Depends(get_app)) -> dict:
    wanted = {"approved": ("approved",), "sent": ("sent",), "replied": ("replied",)}.get(status, ("approved", "sent", "replied"))
    leads = db.scalars(select(Lead).where(Lead.user_id == user.id, Lead.status.in_(wanted))).all()
    names = {c.id: c.name for c in db.scalars(select(Campaign).where(Campaign.user_id == user.id)).all()}
    subjects = serialize.subjects_for(db, leads)

    def when(ld: Lead) -> datetime:
        return ld.replied_at or ld.sent_at or ld.approved_at or ld.updated_at

    leads.sort(key=when, reverse=True)
    items = []
    for ld in leads:
        items.append({
            **serialize.lead_summary(ld, subjects.get(ld.id)),
            "campaign_name": names.get(ld.campaign_id, ""),
            "contact_email": (ld.contact or {}).get("email"),
            "approved_at": iso(ld.approved_at), "sent_at": iso(ld.sent_at), "replied_at": iso(ld.replied_at),
            "reply_outcome": ld.reply_outcome,
        })
    return {"items": items, "sending": sending_today(db, user, app.settings.daily_send_cap)}


# ---------- do not contact ----------

def dnc_out(e: DncEntry) -> dict[str, Any]:
    return {"id": e.id, "business_name": e.business_name, "domain": e.domain, "email": e.email, "reason": e.reason,
            "source": e.source if e.source in ("user", "lead", "reply") else "user", "created_at": iso(e.created_at)}


@router.get("/dnc", response_model=list[schemas.DncEntryOut])
def dnc_list(q: str = "", user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> list:
    stmt = select(DncEntry).where(DncEntry.user_id == user.id)
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(DncEntry.business_name.ilike(like), DncEntry.domain.ilike(like), DncEntry.email.ilike(like)))
    return [dnc_out(e) for e in db.scalars(stmt.order_by(DncEntry.created_at.desc())).all()]


@router.post("/dnc", response_model=schemas.DncEntryOut)
def dnc_add(body: schemas.CreateDncRequest, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> dict:
    name = (body.business_name or "").strip() or None
    email = (body.email or "").strip().lower() or None
    domain_raw = (body.domain or "").strip().lower()
    if email and not is_email(email):
        raise ApiError(422, "validation", "Enter a valid email address.", {"email": "Not valid."})
    domain = None
    if domain_raw:
        if not is_domain(host_of(domain_raw) or ""):
            raise ApiError(422, "validation", "Enter a website address, such as example.com.", {"domain": "Not valid."})
        # the site's domain, or the business's own page when it's on a shared platform such as Facebook
        domain = steps.dnc_domain(domain_raw)
        if domain is None:
            raise ApiError(422, "validation", "That's a shared site. Enter the business's own page on it, such as "
                                              "facebook.com/businessname.", {"domain": "Enter the business's page."})
    if not (name or email or domain):
        raise ApiError(422, "validation", "Add a business name, website or email.")
    if email and not domain:
        domain = None
    e = DncEntry(user_id=user.id, business_name=name, domain=domain, email=email,
                 reason=(body.reason or "").strip()[:300] or None, source="user")
    db.add(e)
    db.flush()
    return dnc_out(e)


@router.delete("/dnc/{entry_id}", status_code=204)
def dnc_delete(entry_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> Response:
    e = db.get(DncEntry, entry_id)
    if e is None or e.user_id != user.id:
        raise ApiError(404, "not_found", "That entry wasn't found.")
    db.delete(e)
    return Response(status_code=204)


@router.get("/dnc/export.csv")
def dnc_export(user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Business", "Website domain", "Email", "Reason", "Added by", "Added"])
    for e in db.scalars(select(DncEntry).where(DncEntry.user_id == user.id).order_by(DncEntry.created_at)).all():
        w.writerow([csv_safe(x) for x in [e.business_name, e.domain, e.email, e.reason, e.source, iso(e.created_at)]])
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="do-not-contact.csv"'})


# ---------- numbers ----------

def _week_start(dt: datetime, tz: ZoneInfo) -> str:
    local = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
    monday = (local - timedelta(days=local.weekday())).date()
    return monday.isoformat()


def compute_stats(db: Session, user: User, app: AppState) -> dict[str, Any]:
    tz = user_tz(user)
    leads = db.scalars(select(Lead).where(Lead.user_id == user.id, Lead.status != "replaced")).all()
    campaigns = db.scalars(select(Campaign).where(Campaign.user_id == user.id).order_by(Campaign.created_at.desc())).all()
    today_local = datetime.now(tz).date()
    this_monday = today_local - timedelta(days=today_local.weekday())
    weeks = [(this_monday - timedelta(weeks=i)).isoformat() for i in range(7, -1, -1)]
    weekly = {w: {"found": 0, "approved": 0, "sent": 0, "replied": 0} for w in weeks}
    by_campaign = {c.id: {"campaign_id": c.id, "name": c.name, "created_at": iso(c.created_at),
                          "found": 0, "approved": 0, "sent": 0, "replied": 0} for c in campaigns}
    totals = {"found": 0, "approved": 0, "sent": 0, "replied": 0}

    def bump(key: str, when: datetime | None, campaign_id: str) -> None:
        totals[key] += 1
        if campaign_id in by_campaign:
            by_campaign[campaign_id][key] += 1
        if when is not None:
            w = _week_start(when, tz)
            if w in weekly:
                weekly[w][key] += 1

    sent_in: dict[str, list[bool]] = {w: [] for w in weeks}  # per week: was each email sent then replied to?
    for ld in leads:
        # An email that was sent stays sent (and a logged reply stays logged) when the business goes on the
        # do-not-contact list afterwards.
        reached = ld.status
        if reached == "dnc":
            reached = "replied" if ld.replied_at else "sent" if ld.sent_at else reached
        if ld.counted:
            bump("found", ld.counted_at, ld.campaign_id)
        if ld.approved_at and reached in ("approved", "sent", "replied"):
            bump("approved", ld.approved_at, ld.campaign_id)
        if ld.sent_at and reached in ("sent", "replied"):
            bump("sent", ld.sent_at, ld.campaign_id)
            week = _week_start(ld.sent_at, tz)
            if week in sent_in:
                sent_in[week].append(bool(ld.replied_at) and reached == "replied")
        if ld.replied_at and reached == "replied":
            bump("replied", ld.replied_at, ld.campaign_id)
    weekly_list = [{"week_start": w, **weekly[w]} for w in weeks]

    def week(i: int) -> dict[str, Any]:
        row = weekly_list[i]
        replies = sent_in[row["week_start"]]  # replies counted by the week the email went out, so never over 100%
        return {**{k: v for k, v in row.items() if k != "week_start"},
                "reply_rate": (sum(replies) / len(replies)) if replies else None}
    return {
        "totals": {**totals, "reply_rate": (totals["replied"] / totals["sent"]) if totals["sent"] else None},
        "this_week": week(-1),
        "last_week": week(-2),
        "weekly": weekly_list,
        "by_campaign": list(by_campaign.values()),
        "sending": sending_today(db, user, app.settings.daily_send_cap),
        "usage": usage(db, user, app.settings.monthly_lead_limit),
    }


@router.get("/stats", response_model=schemas.Stats)
def stats(user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"), app: AppState = Depends(get_app)) -> dict:
    return compute_stats(db, user, app)


@router.get("/stats/export.csv")
def stats_export(user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"), app: AppState = Depends(get_app)) -> Response:
    data = compute_stats(db, user, app)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Section", "Campaign or week", "Found", "Approved", "Sent", "Replied"])
    for c in data["by_campaign"]:
        w.writerow(["Campaign", csv_safe(c["name"]), c["found"], c["approved"], c["sent"], c["replied"]])
    for wk in data["weekly"]:
        w.writerow(["Week starting", wk["week_start"], wk["found"], wk["approved"], wk["sent"], wk["replied"]])
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="nearbynudge-numbers.csv"'})
