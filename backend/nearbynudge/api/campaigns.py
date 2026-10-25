"""Campaigns: plan, start, list, live events, export (CS1, CS2, DB1, DB5)."""

from __future__ import annotations

import asyncio
import csv
import io
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import emailtext, schemas
from ..ai.client import AIError, AIPaused, AIUnavailable, CallContext
from ..db import iso, utcnow
from ..listings.categories import label_for
from ..listings.keys import display_phone
from ..models import Campaign, CampaignPlanRow, EmailVersion, Lead, User
from ..pipeline import jobs, serialize, steps
from ..pipeline.events import sse
from ..pipeline.state import AppState
from ..roles import planner
from .account import usage
from .deps import ApiError, current_user, get_app, get_db, require_onboarded, workspace_id

router = APIRouter(prefix="/api", tags=["campaigns"])

INDUSTRIES = ["Dental Clinics", "Auto Repair", "Restaurants", "Gyms & Fitness", "Hair Salons", "Real Estate Agents",
              "Chiropractors", "Veterinarians", "Law Firms", "HVAC Services", "Plumbers", "Photography Studios"]


def _owned(db: Session, campaign_id: str, user: User) -> Campaign:
    c = db.get(Campaign, campaign_id)
    if c is None or c.user_id != user.id:
        raise ApiError(404, "not_found", "That campaign wasn't found.")
    return c


def _summary(db: Session, c: Campaign, app: AppState) -> dict[str, Any]:
    return serialize.campaign_summary(db, c, paused_message=app.paused_message(), concurrency=app.settings.worker_concurrency)


def _full(db: Session, c: Campaign, app: AppState) -> dict[str, Any]:
    return serialize.campaign_full(db, c, paused_message=app.paused_message(), concurrency=app.settings.worker_concurrency)


@router.get("/campaigns", response_model=list[schemas.CampaignSummary])
def list_campaigns(user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"), app: AppState = Depends(get_app)) -> list:
    rows = db.scalars(select(Campaign).where(Campaign.user_id == user.id).order_by(Campaign.created_at.desc())).all()
    return [_summary(db, c, app) for c in rows]


@router.get("/campaigns/last-input", response_model=schemas.LastInputResponse)
def last_input(user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> dict:
    c = db.scalars(select(Campaign).where(Campaign.user_id == user.id).order_by(Campaign.created_at.desc()).limit(1)).first()
    return {"input": c.input if c else None}


@router.get("/industries", response_model=schemas.IndustriesResponse)
def industries() -> dict:
    return {"suggestions": INDUSTRIES}


@router.get("/geo/suggest", response_model=schemas.GeoSuggestResponse)
def geo_suggest(q: str = "", user: User = Depends(current_user), app: AppState = Depends(get_app)) -> dict:
    if app.gazetteer is None or len(q.strip()) < 2:
        return {"results": []}
    return {"results": [{"label": r.label, "kind": r.kind} for r in app.gazetteer.suggest(q.strip(), limit=8)]}


def _resolve(app: AppState, text: str):
    if app.gazetteer is None:
        raise ApiError(503, "geo_missing", "Location data isn't installed yet. An admin needs to run the setup.")
    geo = app.gazetteer.resolve(text)
    if geo is None:
        raise ApiError(422, "validation", "We couldn't find that place. Try a city with its state (\"Arlington, VA\") or a ZIP code.",
                       {"location": "Add the state, or use a ZIP code."})
    return geo


def _log_task_error(app: AppState, task: asyncio.Task) -> None:
    if not task.cancelled() and task.exception() is not None:
        app.log_error("listings", f"Loading listings for an area failed: {task.exception()}", exc=task.exception())


@router.post("/campaigns/plan", response_model=schemas.CampaignPlan)
async def plan_campaign(body: schemas.CampaignInput, user: User = Depends(require_onboarded),
                        app: AppState = Depends(get_app)) -> dict:
    geo = _resolve(app, body.location)
    store = app.listings
    if store is None:
        raise ApiError(503, "listings_missing", "Business listings aren't installed yet. An admin needs to load them.")
    covered = await asyncio.to_thread(store.covers, geo.lat, geo.lon, body.radius_mi)
    if covered:
        cats = await asyncio.to_thread(store.category_counts, geo.lat, geo.lon, body.radius_mi)
        scope = "area"
    else:
        cats = await asyncio.to_thread(store.all_categories, 3000)
        scope = "all"
        task = asyncio.ensure_future(steps.ensure_area(app, geo.lat, geo.lon, body.radius_mi))  # start loading now
        app.background_tasks.add(task)
        task.add_done_callback(lambda t: (app.background_tasks.discard(t), _log_task_error(app, t)))
    if not cats:
        raise ApiError(503, "listings_missing", "Business listings aren't loaded yet. An admin needs to load them.")
    inp = body.model_dump()
    try:
        out, _ = await planner.plan(app.ai, CallContext(skill="planner", user_id=user.id), inp=inp,
                                    location_label=geo.label, categories=cats, scope=scope)
    except AIPaused as exc:
        raise ApiError(503, "ai_paused", app.paused_message() or "The AI is paused right now. Please try again shortly.") from exc
    except AIUnavailable as exc:
        raise ApiError(503, "ai_paused", "The AI is busy right now. Please try again in a minute.") from exc
    except AIError as exc:
        raise ApiError(502, "ai_error", "The AI couldn't plan this campaign. Try rewording the industry.") from exc
    counts = {k: c for k, _, c in cats}
    labels = {k: lbl for k, lbl, _ in cats}

    def cat(k: str) -> dict[str, Any]:
        return {"key": k, "label": labels.get(k) or label_for(k), "count": counts.get(k) if scope == "area" else None}

    included = [cat(k) for k in out.include]
    question = None
    if out.question is not None and out.question.categories:
        question = {"text": out.question.text, "categories": [cat(k) for k in out.question.categories]}
    candidate_count = None
    warnings: list[str] = []
    if covered and out.include:
        places, domains, _, names = await app.db.arun(lambda s: steps.user_excludes(s, user.id))
        found = await asyncio.to_thread(store.find_candidates, geo.lat, geo.lon, body.radius_mi, out.include,
                                        exclude_place_ids=frozenset(places), exclude_domains=frozenset(domains), limit=500)
        candidate_count = len([f for f in found if steps.name_key(f.name) not in names])
        if candidate_count < body.lead_target:
            wider = min(25, int(body.radius_mi * 2))
            warnings.append(f"Only {candidate_count} businesses match. Try a {wider}-mile radius or a broader industry.")
    if not out.include:
        warnings.append("We couldn't match that industry to our listings. Try a more common name for it.")
    if out.warning and out.warning not in warnings:
        warnings.append(out.warning)
    plan = {
        "location": {"label": geo.label, "kind": geo.kind, "lat": geo.lat, "lon": geo.lon, "note": geo.note},
        "restatement": out.restatement,
        "categories": included,
        "question": question,
        "candidate_count": candidate_count,
        "coverage": "ready" if covered else "loading_needed",
        "warnings": warnings,
    }

    def save(s: Session) -> str:
        row = CampaignPlanRow(user_id=user.id, input=inp, plan=plan, expires_at=utcnow() + timedelta(hours=1))
        s.add(row)
        s.flush()
        return row.id

    plan_id = await app.db.arun(save)
    return {"plan_id": plan_id, **plan}


@router.post("/campaigns", response_model=schemas.Campaign)
def create_campaign(body: schemas.CreateCampaignRequest, user: User = Depends(require_onboarded),
                    db: Session = Depends(get_db, scope="function"), app: AppState = Depends(get_app)) -> dict:
    row = db.get(CampaignPlanRow, body.plan_id)
    if row is None or row.user_id != user.id or row.expires_at <= utcnow():
        raise ApiError(409, "plan_expired", "This plan has expired. Review the plan again to start.")
    planned = row.input
    inp = body.input.model_dump()
    for key in ("location", "radius_mi", "industry"):
        if str(planned.get(key)) != str(inp.get(key)):
            raise ApiError(409, "plan_changed", "The location, radius or industry changed. Review the plan again to start.")
    plan = row.plan
    include = [c["key"] for c in plan.get("categories", [])]
    question = plan.get("question")
    if body.answer == "yes" and question:
        include += [c["key"] for c in question.get("categories", [])]
    if not include:
        raise ApiError(422, "validation", "We couldn't match that industry to our listings. Try a more common name for it.")
    used = usage(db, user, app.settings.monthly_lead_limit)
    reserved = db.scalar(select(func.count()).select_from(Lead).where(
        Lead.user_id == user.id, Lead.counted.is_(False), Lead.status.in_(serialize.IN_PROGRESS))) or 0
    remaining = used["limit"] - used["used"] - int(reserved)
    if remaining < 5:
        busy = f" ({reserved} more are being researched now)" if reserved else ""
        raise ApiError(409, "usage_limit", f"You've used {used['used']} of {used['limit']} leads this month{busy}. "
                                           "Your allowance resets next month.")
    target = min(inp["lead_target"], remaining)
    loc = plan["location"]
    name = f"{inp['industry'].strip().capitalize()} within {inp['radius_mi']:g} mi of {loc['label']}"
    categories = plan.get("categories", [])
    if body.answer == "yes" and question:
        categories = categories + question.get("categories", [])
    c = Campaign(
        user_id=user.id, name=name[:300], location_label=loc["label"], lat=loc["lat"], lon=loc["lon"],
        radius_mi=float(inp["radius_mi"]), industry=inp["industry"], input={**inp, "lead_target": target},
        restatement=plan.get("restatement", ""), categories=categories, include_keys=include,
        question=question, answer=body.answer if question else None, status="finding",
        status_detail=f"Finding businesses near {loc['label']}…", lead_target=target, notices=[],
    )
    if target < inp["lead_target"]:
        c.notices = [f"Your monthly allowance has {remaining} leads left, so this campaign looks for {target}."]
    db.add(c)
    db.flush()
    jobs.enqueue(db, kind="discover", user_id=user.id, campaign_id=c.id)
    db.delete(row)
    db.flush()
    if app.worker:
        app.worker.wake()
    return _full(db, c, app)


@router.get("/campaigns/{campaign_id}", response_model=schemas.Campaign)
def get_campaign(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
                 app: AppState = Depends(get_app)) -> dict:
    return _full(db, _owned(db, campaign_id, user), app)


@router.delete("/campaigns/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function"),
                    app: AppState = Depends(get_app)) -> Response:
    c = _owned(db, campaign_id, user)
    jobs.cancel_for_campaign(db, c.id)
    if app.worker:
        app.worker.cancel_campaign(c.id)
    db.delete(c)
    return Response(status_code=204)


@router.get("/campaigns/{campaign_id}/leads", response_model=list[schemas.LeadSummary])
def campaign_leads(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> list:
    c = _owned(db, campaign_id, user)
    leads = db.scalars(select(Lead).where(Lead.campaign_id == c.id, Lead.status != "replaced")).all()
    subjects = serialize.subjects_for(db, leads)
    leads.sort(key=lambda ld: (-(serialize.lead_fit(ld) if serialize.lead_fit(ld) is not None else -1), ld.rank, ld.created_at))
    return [serialize.lead_summary(ld, subjects.get(ld.id)) for ld in leads]


@router.get("/campaigns/{campaign_id}/events")
async def campaign_events(campaign_id: str, request: Request, app: AppState = Depends(get_app)) -> StreamingResponse:
    # A short-lived session only: a stream can stay open for hours and must not hold a database connection.
    workspace = workspace_id(request)

    def load(s: Session) -> dict[str, Any] | None:
        c = s.get(Campaign, campaign_id)
        return _summary(s, c, app) if c and c.user_id == workspace else None

    snapshot = await app.db.arun(load)
    if snapshot is None:
        raise ApiError(404, "not_found", "That campaign wasn't found.")
    queue = app.broker.subscribe(campaign_id)

    async def stream():
        try:
            yield "retry: 3000\n\n"
            yield sse("campaign", snapshot)
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                    yield sse(item["event"], item["data"])
                except TimeoutError:
                    yield sse("ping", {})
        finally:
            app.broker.unsubscribe(campaign_id, queue)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


def csv_safe(value: Any) -> str:
    text = "" if value is None else str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text  # keep spreadsheets from running cell formulas
    return text


@router.get("/campaigns/{campaign_id}/export.csv")
def export_campaign(campaign_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> Response:
    c = _owned(db, campaign_id, user)
    leads = db.scalars(select(Lead).where(Lead.campaign_id == c.id, Lead.status != "replaced").order_by(Lead.rank)).all()
    footer = emailtext.build_footer(user.profile)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Business", "Category", "Address", "Distance (mi)", "Website", "Phone", "Contact email", "Contact form",
                "Contact source", "Fit score", "Fit", "Why", "Hook", "Subject", "Email", "Status", "Approved", "Sent",
                "Replied", "Reply outcome", "Skip reason"])
    for ld in leads:
        v = db.get(EmailVersion, ld.email_version_id) if ld.email_version_id else None
        contact = ld.contact or {}
        hook = (ld.hooks or [{}])[0] if ld.hooks else {}
        score = serialize.lead_fit(ld)
        w.writerow([csv_safe(x) for x in [
            ld.name, ld.category_label, ld.address, ld.distance_mi, ld.website, display_phone(ld.phone), contact.get("email"),
            contact.get("form_url"), contact.get("source_label"), score, serialize.fit_label(score),
            ld.fit_reason or ld.scout_reason, hook.get("title"), v.subject if v else None,
            emailtext.full_text(v.greeting, v.paragraphs or [], v.signoff, footer) if v else None,
            ld.status, iso(ld.approved_at), iso(ld.sent_at), iso(ld.replied_at), ld.reply_outcome, ld.skip_reason,
        ]])
    filename = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in c.name.lower())[:60].strip("-") or "campaign"
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'})
