"""The campaign pipeline: discover → (per lead) research → hook → write → check.

Every stage saves its result before the next starts, so a lead resumes where it stopped after
a pause or restart. AI errors that mean "wait" (AIPaused, AIUnavailable) propagate to the worker,
which re-queues the job; everything else ends the lead in a clear state with a way forward.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import emailtext
from ..ai.client import AIPaused, AIRefusal, AIRequestError, AIUnavailable, CallContext, StructuredOutputError
from ..db import iso, utcnow
from ..models import Campaign, Candidate, DncEntry, EmailVersion, Fact, Lead, Page, User
from ..reader import (
    PageResult,
    SiteBudget,
    find_contact,
    mask_contacts,
    normalize_url,
    page_label,
    pick_links,
    quote_in_text,
    registrable_domain,
    site_check,
)
from ..roles import editor as editor_role
from ..roles import researcher as researcher_role
from ..roles import scout as scout_role
from ..roles import writer as writer_role
from ..roles.outputs import EmailOut, HookOut, SentenceOut
from ..roles.skills import PromptFact
from . import jobs, serialize
from .serialize import IN_PROGRESS
from .state import AppState

log = logging.getLogger("nearbynudge.pipeline")

DRAFTED = ("ready", "needs_review", "approved", "sent", "replied", "skipped", "dnc")
SCOUT_POOL = 60
READER_ERRORS_FRIENDLY = {
    "robots_disallowed": "the site asks robots not to read it",
    "robots_unreadable": "the site's robots.txt couldn't be read, so we stayed out",
    "opted_out": "the site owner asked NearbyNudgeBot not to read it",
    "off_site": "the website sends visitors to a different site",
    "blocked_address": "the website address isn't a public site",
    "not_html": "the website isn't a normal web page",
    "too_large": "the home page is too large to read",
    "http_error": "the website returned an error",
    "timeout": "the website didn't respond in time",
    "network": "the website couldn't be reached",
    "bot_check": "the website blocks automated visitors",
    "login_page": "the website needs a login",
    "budget_exceeded": "the page limit for this site was reached",
}


# ---------- helpers ----------

def month_label(release: str | None) -> str:
    try:
        y, m = int(release[:4]), int(release[5:7])  # type: ignore[index]
        return date(y, m, 1).strftime("%b %Y")
    except (TypeError, ValueError):
        return "latest release"


def listing_label(release: str | None) -> str:
    return f"Business listing (Overture Maps, {month_label(release)})"


def _ctx(skill: str, lead: dict[str, Any] | None = None, campaign: dict[str, Any] | None = None) -> CallContext:
    src = lead or campaign or {}
    return CallContext(
        skill=skill, user_id=src.get("user_id"), campaign_id=src.get("campaign_id") or (campaign or {}).get("id"),
        lead_id=(lead or {}).get("id"),
    )


def lead_snapshot(lead: Lead) -> dict[str, Any]:
    return {
        "id": lead.id, "campaign_id": lead.campaign_id, "user_id": lead.user_id, "name": lead.name,
        "status": lead.status, "website": lead.website, "domain": lead.domain, "address": lead.address,
        "locality": lead.locality, "category_label": lead.category_label, "distance_mi": lead.distance_mi,
        "listing": dict(lead.listing or {}), "research_mode": lead.research_mode, "cost_usd": lead.cost_usd or 0.0,
        "summary": lead.summary, "owner_name": lead.owner_name, "place_id": lead.place_id,
        "email_version_id": lead.email_version_id, "hooks": list(lead.hooks or []),
    }


def business_info(lead: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": lead["name"],
        "short_name": emailtext.short_business_name(lead["name"]),
        "category_label": lead["category_label"],
        "address": lead["address"],
        "distance_mi": lead["distance_mi"],
        "website": lead["website"],
        "summary": lead.get("summary"),
        "owner_name": lead.get("owner_name"),
    }


def update_lead(app: AppState, lead_id: str, *, expect: tuple[str, ...] | None = IN_PROGRESS,
                **fields: Any) -> dict[str, Any] | None:
    """Apply fields to a lead, publish the change, and return a fresh snapshot.

    Pipeline writes pass `expect` (default: still in progress) so a decision the user made while a stage
    was running (skip, do not contact, delete) is never overwritten; then None is returned and the run stops.
    """
    def fn(s: Session) -> dict[str, Any] | None:
        lead = s.get(Lead, lead_id)
        if lead is None or (expect is not None and lead.status not in expect):
            return None
        for k, v in fields.items():
            setattr(lead, k, v)
        lead.updated_at = utcnow()
        s.flush()
        app.publish_lead(s, lead)
        return lead_snapshot(lead)
    return app.db.run(fn)


async def aupdate_lead(app: AppState, lead_id: str, *, expect: tuple[str, ...] | None = IN_PROGRESS,
                       **fields: Any) -> dict[str, Any] | None:
    return await asyncio.to_thread(lambda: update_lead(app, lead_id, expect=expect, **fields))


async def guarded(app: AppState, lead_id: str, fn) -> tuple[bool, Any]:
    """Run fn(session, lead) in one transaction only while the lead is still in progress.
    Returns (ran, value). Not running means the user decided something meanwhile: stop."""
    def run(s: Session) -> tuple[bool, Any]:
        lead = s.get(Lead, lead_id)
        if lead is None or lead.status not in IN_PROGRESS:
            return False, None
        return True, fn(s, lead)
    return await app.db.arun(run)


def name_key(name: str | None) -> str:
    """A business name for do-not-contact matching: legal suffixes dropped, case and punctuation ignored."""
    short = emailtext.short_business_name(name or "")
    return " ".join(re.sub(r"[^a-z0-9& ]+", " ", short.lower()).split())


def user_excludes(s: Session, user_id: str) -> tuple[set[str], set[str], set[str], set[str]]:
    """(place ids, domains, emails, name keys) the user must not get again: do-not-contact plus businesses
    already drafted or in progress."""
    places: set[str] = set()
    domains: set[str] = set()
    emails: set[str] = set()
    names: set[str] = set()
    for e in s.scalars(select(DncEntry).where(DncEntry.user_id == user_id)).all():
        if e.place_id:
            places.add(e.place_id)
        if e.domain:
            domains.add(e.domain.lower())
        if e.email:
            emails.add(e.email.lower())
        if e.business_name and not (e.place_id or e.domain or e.email):
            names.add(name_key(e.business_name))
    rows = s.execute(
        select(Lead.place_id, Lead.domain).where(Lead.user_id == user_id, Lead.status.in_((*DRAFTED, *IN_PROGRESS)))
    ).all()
    for place_id, domain in rows:
        places.add(place_id)
        if domain:
            domains.add(domain.lower())
    names.discard("")
    return places, domains, emails, names


def is_dnc(s: Session, user_id: str, *, place_id: str | None, domain: str | None, email: str | None,
           name: str | None = None) -> bool:
    if name:
        key = name_key(name)
        for (bn,) in s.execute(select(DncEntry.business_name).where(
                DncEntry.user_id == user_id, DncEntry.business_name.is_not(None))).all():
            if key and name_key(bn) == key:
                return True
    q = select(DncEntry.id).where(DncEntry.user_id == user_id)
    conds = []
    if place_id:
        conds.append(DncEntry.place_id == place_id)
    if domain:
        conds.append(DncEntry.domain == domain.lower())
    if email:
        conds.append(DncEntry.email == email.lower())
    if not conds:
        return False
    from sqlalchemy import or_

    return s.scalars(q.where(or_(*conds)).limit(1)).first() is not None


def _address(listing: Any) -> str:
    region_zip = " ".join(x for x in [listing.region or "", listing.postcode or ""] if x)
    parts = [listing.street or "", listing.locality or "", region_zip]
    return ", ".join(p for p in parts if p)


def new_lead(campaign: Campaign, listing: Any, *, rank: int, score: int | None, reason: str | None,
             candidate_id: str | None) -> Lead:
    website = next((w.strip() for w in (listing.websites or []) if w and w.strip()), None)
    if website and "://" in website and not website.lower().startswith(("http://", "https://")):
        website = None  # only web addresses; a bare "example.com" is kept (the reader tries https first)
    domain = registrable_domain(website) if website else None
    locality = ", ".join(x for x in [listing.locality or "", listing.region or ""] if x)
    snapshot = {
        "place_id": listing.place_id, "emails": list(listing.emails or []), "phones": list(listing.phones or []),
        "websites": list(listing.websites or []), "socials": list(listing.socials or []),
        "source_dataset": listing.source_dataset, "source_updated": listing.source_updated,
        "release": listing.release, "confidence": listing.confidence, "category": listing.category,
        "basic_category": listing.basic_category, "brand": listing.brand, "city": listing.locality,
        "region": listing.region, "postcode": listing.postcode,
    }
    return Lead(
        campaign_id=campaign.id, user_id=campaign.user_id, candidate_id=candidate_id, place_id=listing.place_id,
        rank=rank, name=listing.name, category=listing.category, category_label=listing.category_label or "",
        address=_address(listing), locality=locality, lat=listing.lat, lon=listing.lon,
        distance_mi=round(listing.distance_mi or 0.0, 1), website=website, domain=domain,
        phone=(listing.phones or [None])[0], listing=snapshot, status="queued", stage_label="Queued",
        scout_score=score, scout_reason=reason,
    )


def listing_from_snapshot(data: dict[str, Any]):
    from ..listings import Listing

    return Listing(**data)


# ---------- discovery ----------

async def discover(app: AppState, campaign_id: str) -> None:
    def load(s: Session) -> dict[str, Any] | None:
        c = s.get(Campaign, campaign_id)
        if c is None:
            return None
        if s.scalars(select(Candidate.id).where(Candidate.campaign_id == campaign_id).limit(1)).first() is not None:
            return {"already": True}  # discovery already finished (a re-queued job after a restart)
        c.status = "finding"
        c.status_detail = f"Finding businesses near {c.location_label}…"
        c.started_at = c.started_at or utcnow()
        s.flush()
        app.publish_campaign(s, c)
        return {"id": c.id, "user_id": c.user_id, "lat": c.lat, "lon": c.lon, "radius": c.radius_mi,
                "include": list(c.include_keys or []), "input": dict(c.input), "label": c.location_label,
                "target": c.lead_target}

    camp = await app.db.arun(load)
    if camp is None or camp.get("already"):
        return
    store = app.listings
    if store is None:
        await _finish_discovery(app, campaign_id, [], notice="Business listings aren't installed yet. An admin needs to load them.")
        return

    if not await asyncio.to_thread(store.covers, camp["lat"], camp["lon"], camp["radius"]):
        await _set_campaign(app, campaign_id, status_detail="Loading business listings for this area (first time only, about a minute)…")
        await ensure_area(app, camp["lat"], camp["lon"], camp["radius"])

    places, domains, _emails, names = await app.db.arun(lambda s: user_excludes(s, camp["user_id"]))
    listings = await asyncio.to_thread(
        store.find_candidates, camp["lat"], camp["lon"], camp["radius"], camp["include"],
        exclude_place_ids=frozenset(places), exclude_domains=frozenset(domains), limit=200,
    )
    if names:
        listings = [lst for lst in listings if name_key(lst.name) not in names]
    if not listings:
        await _finish_discovery(app, campaign_id, [], notice=(
            f"We found no businesses that match near {camp['label']}. Try a larger radius or a broader industry."))
        return

    pool = listings[:SCOUT_POOL]
    short = {f"c{i}": lst for i, lst in enumerate(pool, 1)}
    want = camp["target"]
    ranked: list[tuple[Any, int | None, str | None]] = []
    try:
        items, _cost = await scout_role.rank(
            app.ai, _ctx("scout", campaign={"id": campaign_id, "user_id": camp["user_id"]}),
            inp=camp["input"], location_label=camp["label"],
            candidates=[{"id": k, "name": v.name, "category_label": v.category_label, "distance_mi": v.distance_mi,
                         "website": next((w for w in (v.websites or []) if w), None), "locality": v.locality}
                        for k, v in short.items()],
            want=want, can_check_without_site=app.settings.ai_web_search and app.web_search_state != "unavailable",
        )
        ranked = [(short[i.id], i.score, i.reason) for i in items]
    except (AIRequestError, StructuredOutputError) as exc:
        await app.alog_error("pipeline", f"Scout ranking failed; using listing order: {exc}", campaign_id=campaign_id)
    if len(ranked) < want + 5:  # top up with the rest of the pool in listing order
        taken = {id(r[0]) for r in ranked}
        ranked += [(lst, None, None) for lst in pool if id(lst) not in taken][: want + 5 - len(ranked)]
    await _finish_discovery(app, campaign_id, ranked)


async def ensure_area(app: AppState, lat: float, lon: float, radius: float) -> None:
    """Load listings around a point once, even if several requests ask at the same time."""
    store = app.listings
    if store is None:
        return
    key = f"{round(lat, 2)}:{round(lon, 2)}:{int(radius)}"
    task = app.area_loads.get(key)
    if task is None or task.done():
        task = asyncio.ensure_future(asyncio.to_thread(store.load_area, lat, lon, radius))
        app.area_loads[key] = task
    try:
        await asyncio.shield(task)
    finally:
        if task.done():
            app.area_loads.pop(key, None)


async def _set_campaign(app: AppState, campaign_id: str, **fields: Any) -> None:
    def fn(s: Session) -> None:
        c = s.get(Campaign, campaign_id)
        if c is None:
            return
        for k, v in fields.items():
            setattr(c, k, v)
        s.flush()
        app.publish_campaign(s, c)
    await app.db.arun(fn)


async def _finish_discovery(app: AppState, campaign_id: str, ranked: list[tuple[Any, int | None, str | None]],
                            notice: str | None = None) -> None:
    def fn(s: Session) -> None:
        c = s.get(Campaign, campaign_id)
        if c is None:
            return
        if s.scalars(select(Candidate.id).where(Candidate.campaign_id == campaign_id).limit(1)).first() is not None:
            return  # never create a second set of leads
        notices = list(c.notices or [])
        if notice:
            notices.append(notice)
        promoted = 0
        for rank, (lst, score, reason) in enumerate(ranked, 1):
            cand = Candidate(campaign_id=c.id, place_id=lst.place_id, rank=rank, score=score, reason=reason,
                             listing=_listing_dict(lst), status="reserve")
            s.add(cand)
            s.flush()
            if promoted < c.lead_target:
                cand.status = "promoted"
                lead = new_lead(c, lst, rank=rank, score=score, reason=reason, candidate_id=cand.id)
                s.add(lead)
                s.flush()
                jobs.enqueue(s, kind="lead", user_id=c.user_id, campaign_id=c.id, lead_id=lead.id)
                app.publish_lead(s, lead)
                promoted += 1
        if ranked and promoted < c.lead_target:
            wider = min(25, int(c.radius_mi * 2))
            notices.append(f"We found {promoted} of {c.lead_target}. Try a {wider}-mile radius or a broader industry.")
        c.notices = notices
        if promoted:
            c.status = "researching"
            c.status_detail = None
        else:
            c.status = "done"
            c.status_detail = None
            c.finished_at = utcnow()
            c.finish = _finish_summary(s, c)
        s.flush()
        app.publish_campaign(s, c)
    await app.db.arun(fn)
    if app.worker:
        app.worker.wake()


def _listing_dict(lst: Any) -> dict[str, Any]:
    from dataclasses import asdict

    return asdict(lst)


def promote_next(app: AppState, s: Session, campaign: Campaign) -> Lead | None:
    """Replace a lead that failed verification with the next business in line (LD3)."""
    if campaign.replacements_used >= campaign.lead_target:
        return None
    places, domains, _, names = user_excludes(s, campaign.user_id)
    for cand in s.scalars(
        select(Candidate).where(Candidate.campaign_id == campaign.id, Candidate.status == "reserve").order_by(Candidate.rank)
    ).all():
        lst = listing_from_snapshot(cand.listing)
        website = next((w for w in (lst.websites or []) if w), None)
        dom = registrable_domain(website) if website else None
        cand.status = "promoted"
        if lst.place_id in places or (dom and dom in domains) or name_key(lst.name) in names:
            continue
        campaign.replacements_used += 1
        lead = new_lead(campaign, lst, rank=cand.rank, score=cand.score, reason=cand.reason, candidate_id=cand.id)
        s.add(lead)
        s.flush()
        jobs.enqueue(s, kind="lead", user_id=campaign.user_id, campaign_id=campaign.id, lead_id=lead.id)
        app.publish_lead(s, lead)
        if campaign.status == "done":
            campaign.status = "researching"
            campaign.finished_at = None
        return lead
    return None


def _finish_summary(s: Session, c: Campaign) -> dict[str, Any]:
    leads = s.scalars(select(Lead).where(Lead.campaign_id == c.id)).all()
    seconds = int(((c.finished_at or utcnow()) - (c.started_at or c.created_at)).total_seconds())
    return {
        "found": sum(1 for ld in leads if ld.status not in ("replaced", "failed")),
        "ready": sum(1 for ld in leads if ld.status == "ready"),
        "needs_review": sum(1 for ld in leads if ld.status == "needs_review"),
        "failed": [{"lead_id": ld.id, "name": ld.name, "reason": ld.error or "Couldn't finish"} for ld in leads if ld.status == "failed"],
        "replaced": [{"name": ld.name, "reason": ld.replaced_reason or "Didn't pass verification"} for ld in leads if ld.status == "replaced"],
        "seconds": max(0, seconds),
    }


def maybe_finish_campaign(app: AppState, s: Session, campaign_id: str) -> None:
    c = s.get(Campaign, campaign_id)
    if c is None or c.status == "done":
        return
    in_progress = s.scalars(
        select(Lead.id).where(Lead.campaign_id == campaign_id, Lead.status.in_(IN_PROGRESS)).limit(1)
    ).first()
    if in_progress is not None:
        app.publish_campaign(s, c)
        return
    c.status = "done"
    c.status_detail = None
    c.finished_at = utcnow()
    replaced = s.scalars(select(Lead).where(Lead.campaign_id == campaign_id, Lead.status == "replaced")).all()
    notices = [n for n in (c.notices or []) if not n.startswith("Replaced ")]
    if replaced:
        kinds: dict[str, int] = {}
        for r in replaced:
            reason = (r.replaced_reason or "").lower()
            if reason.startswith("looked closed"):
                key = "looked closed"
            elif reason.startswith("listed at a different address"):
                key = "listed a different address"
            elif reason.startswith("no website"):
                key = "had no website we could check"
            else:
                key = "couldn't be verified"
            kinds[key] = kinds.get(key, 0) + 1
        parts = ", ".join(f"{n} {k}" for k, n in kinds.items())
        notices.append(f"Replaced {len(replaced)} {'business' if len(replaced) == 1 else 'businesses'}: {parts}.")
    c.notices = notices
    c.finish = _finish_summary(s, c)
    s.flush()
    app.publish_campaign(s, c)


# ---------- per lead ----------

async def process_lead(app: AppState, lead_id: str) -> None:
    lead = await app.db.arun(lambda s: (lambda ld: lead_snapshot(ld) if ld else None)(s.get(Lead, lead_id)))
    if lead is None or lead["status"] not in IN_PROGRESS:
        return
    campaign_id = lead["campaign_id"]
    stages = {"queued": research_stage, "reading": research_stage, "choosing": strategy_stage,
              "writing": writing_stage, "checking": editor_stage}
    try:
        blocked = await app.db.arun(lambda s: is_dnc(
            s, lead["user_id"], place_id=lead["place_id"], domain=lead["domain"], email=None, name=lead["name"]))
        if blocked:
            await _dnc_and_replace(app, lead)
            return
        await app.db.arun(lambda s: _mark_started(s, lead_id))
        for _ in range(8):  # each stage saves before the next, so a lead resumes where it stopped
            if lead is None or lead["status"] not in IN_PROGRESS:
                break
            if lead["status"] not in ("queued", "reading") and await _over_cap(app, lead_id):
                await _fail(app, lead_id, COST_CAP_MESSAGE)
                break
            lead = await stages[lead["status"]](app, lead)
    except (AIPaused, AIUnavailable):
        raise
    except AIRefusal as exc:
        await _fail(app, lead_id, "Couldn't finish: the AI declined to write about this business.", exc=exc)
    except (AIRequestError, StructuredOutputError) as exc:
        await _fail(app, lead_id, "Couldn't finish: the AI's answer couldn't be used. Retry, or review without site facts.", exc=exc)
    finally:
        await app.db.arun(lambda s: maybe_finish_campaign(app, s, campaign_id))


def _mark_started(s: Session, lead_id: str) -> None:
    lead = s.get(Lead, lead_id)
    if lead is not None and lead.started_at is None:
        lead.started_at = utcnow()


COST_CAP_MESSAGE = "Couldn't finish: research reached the cost limit for one lead."


async def _over_cap(app: AppState, lead_id: str) -> bool:
    def fn(s: Session) -> float:
        ld = s.get(Lead, lead_id)
        return (ld.cost_usd or 0.0) if ld else 0.0
    return (await app.db.arun(fn)) >= app.settings.lead_cost_cap_usd


async def _fail(app: AppState, lead_id: str, message: str, *, exc: BaseException | None = None) -> None:
    if exc is not None:
        await app.alog_error("pipeline", f"{message} ({exc})", exc=exc, lead_id=lead_id)
    await _end_lead(app, lead_id, status="failed", error=message, stage_label=None, step=None)


async def _end_lead(app: AppState, lead_id: str, **fields: Any) -> None:
    await aupdate_lead(app, lead_id, **fields)


async def _replace(app: AppState, lead: dict[str, Any], reason: str) -> None:
    def fn(s: Session) -> None:
        ld = s.get(Lead, lead["id"])
        if ld is None or ld.status not in IN_PROGRESS:
            return
        ld.status = "replaced"
        ld.replaced_reason = reason
        ld.stage_label = None
        ld.step = None
        ld.updated_at = utcnow()
        s.flush()
        app.publish_lead(s, ld)
        c = s.get(Campaign, ld.campaign_id)
        if c is not None:
            promote_next(app, s, c)
    await app.db.arun(fn)
    if app.worker:
        app.worker.wake()


async def _fail_and_replace(app: AppState, lead: dict[str, Any], message: str) -> None:
    def fn(s: Session) -> None:
        ld = s.get(Lead, lead["id"])
        if ld is None or ld.status not in IN_PROGRESS:
            return
        ld.status = "failed"
        ld.error = message
        ld.stage_label = None
        ld.step = None
        ld.updated_at = utcnow()
        s.flush()
        app.publish_lead(s, ld)
        c = s.get(Campaign, ld.campaign_id)
        if c is not None:
            promote_next(app, s, c)
    await app.db.arun(fn)
    if app.worker:
        app.worker.wake()


async def _dnc_and_replace(app: AppState, lead: dict[str, Any], **fields: Any) -> None:
    """The business is on the user's do-not-contact list: never draft it, and bring in the next in line."""
    def fn(s: Session) -> None:
        ld = s.get(Lead, lead["id"])
        if ld is None or ld.status not in IN_PROGRESS:
            return
        for k, v in fields.items():
            setattr(ld, k, v)
        ld.status = "dnc"
        ld.dnc_at = utcnow()
        ld.stage_label = None
        ld.step = None
        ld.updated_at = utcnow()
        s.flush()
        app.publish_lead(s, ld)
        c = s.get(Campaign, ld.campaign_id)
        if c is not None:
            promote_next(app, s, c)
    await app.db.arun(fn)
    if app.worker:
        app.worker.wake()


def _save_pages(s: Session, lead_id: str, pages: list[PageResult]) -> list[dict[str, Any]]:
    read = []
    for p in pages:
        if not p.ok:
            continue
        label = page_label(p.final_url, p.title)
        s.add(Page(lead_id=lead_id, url=p.url, final_url=p.final_url, label=label, title=(p.title or "")[:500],
                   status=p.status, text=p.text or "", load_ms=p.load_ms or 0,
                   fetched_at=p.fetched_at.replace(tzinfo=None) if p.fetched_at else utcnow()))
        read.append({"url": p.final_url, "label": label, "fetched_at": iso(p.fetched_at)})
    return read


async def research_stage(app: AppState, lead: dict[str, Any]) -> dict[str, Any] | None:
    lead_id = lead["id"]
    started = await aupdate_lead(app, lead_id, status="reading", step=1, stage_label="Reading site")
    if started is None:
        return None
    lead = started
    offer = await app.db.arun(lambda s: dict(s.get(Campaign, lead["campaign_id"]).input))
    rel = lead["listing"].get("release")

    if lead["research_mode"] == "without_site":
        return await _commit_research(
            app, lead_id, [_listing_fact(lead, rel)], status="choosing", step=2, stage_label="Choosing hook",
            verification={"status": "unverified", "note": "Reviewed without site facts, at your request.", "url": None},
        )

    if not lead["website"]:
        if not app.settings.ai_web_search or app.web_search_state == "unavailable":
            await _replace(app, lead, "No website to check")
            return None
        return await _research_by_search(app, lead, offer, rel)

    reader = app.reader
    if reader is None:
        await _fail_and_replace(app, lead, "Couldn't finish: the website reader isn't running.")
        return None
    budget = SiteBudget(max_pages=5)
    try:
        home = await reader.fetch_home(lead["website"], budget)
        root = site_root(lead["website"])
        listed_path = urlsplit(lead["website"] if "://" in lead["website"] else "//" + lead["website"]).path
        if not home.ok and home.error in ("http_error", "not_html") and root and listed_path not in ("", "/"):
            # listings sometimes link to an inner page that has moved; try the site's home page once
            retry = await reader.fetch_home(root, budget)
            if retry.ok:
                home = retry
    except Exception as exc:  # noqa: BLE001 - a broken site must not break the run
        await app.alog_error("reader", f"fetch_home crashed for {lead['website']}: {exc}", exc=exc, lead_id=lead_id)
        await _fail_and_replace(app, lead, "Couldn't read site: the website couldn't be reached.")
        return None
    if not home.ok:
        why = READER_ERRORS_FRIENDLY.get(home.error or "", "the website couldn't be read")
        await _fail_and_replace(app, lead, f"Couldn't read site: {why}.")
        return None
    ran, pages_read = await guarded(app, lead_id, lambda s, ld: _save_pages(s, lead_id, [home]))
    if not ran:
        return None
    if await aupdate_lead(app, lead_id, pages_read=pages_read) is None:
        return None
    links = pick_links(home, limit=20)

    read_pages: list[PageResult] = []

    async def read(urls: list[str]) -> list[PageResult]:
        nonlocal pages_read
        out: list[PageResult] = []
        for i, u in enumerate(urls, 1):
            await aupdate_lead(app, lead_id, stage_label=f"Reading site ({i + 1} of {len(urls) + 1} pages)")
            try:
                p = await reader.fetch(u, site=home.final_url, budget=budget)
            except Exception as exc:  # noqa: BLE001
                await app.alog_error("reader", f"fetch crashed for {u}: {exc}", exc=exc, lead_id=lead_id)
                continue
            out.append(p)
        _ran, saved = await guarded(app, lead_id, lambda s, ld: _save_pages(s, lead_id, out))
        pages_read = pages_read + (saved or [])
        await aupdate_lead(app, lead_id, pages_read=pages_read, stage_label="Reading site")
        read_pages.extend(out)
        return out

    rr = await researcher_role.research_site(
        app.ai, _ctx("researcher", lead=lead), listing=lead_listing_info(lead), offer=offer,
        home=home, links=links, read=read,
    )
    pages = [home] + [p for p in read_pages if p.ok]
    out = rr.out
    v = out.verification
    if v.closed_signal or v.operating == "no":
        await _replace(app, lead, "Looked closed: " + (v.note or "the website says it closed or moved"))
        return None
    if v.address_match == "no":
        await _replace(app, lead, "Listed at a different address: " + (v.note or "the website shows another location"))
        return None

    facts = build_research_facts(out, pages)
    sc = site_check(home, pages[1:])
    facts += site_check_facts(sc, home)
    facts.append(_listing_fact(lead, rel))
    contact = find_contact(
        listing_emails=list(lead["listing"].get("emails") or []), website=lead["website"], pages=pages,
        listing_label=listing_label(rel),
    )
    contact_d = contact.to_dict()
    blocked = await app.db.arun(lambda s: is_dnc(s, lead["user_id"], place_id=None, domain=None, email=contact.email))
    verification = {
        "status": "verified" if v.operating == "yes" else "unverified",
        "note": v.note or ("The website shows the business operating." if v.operating == "yes" else "The website didn't clearly show it operating."),
        "url": home.final_url,
    }
    if blocked:
        await _dnc_and_replace(app, lead, contact=contact_d, site_check=sc.to_dict(), verification=verification)
        return None
    return await _commit_research(
        app, lead_id, facts, status="choosing", step=2, stage_label="Choosing hook", contact=contact_d,
        site_check=sc.to_dict(), verification=verification, summary=out.summary[:500] if out.summary else None,
        owner_name=out.owner_name,
    )


async def _commit_research(app: AppState, lead_id: str, facts: list[dict[str, Any]], **fields: Any) -> dict[str, Any] | None:
    """Save the facts and move the lead on, in one transaction, only if it is still in progress."""
    def fn(s: Session, ld: Lead) -> dict[str, Any]:
        _replace_facts(s, lead_id, facts)
        for k, v in fields.items():
            setattr(ld, k, v)
        ld.updated_at = utcnow()
        s.flush()
        app.publish_lead(s, ld)
        return lead_snapshot(ld)
    _ran, snap = await guarded(app, lead_id, fn)
    return snap


def site_root(website: str | None) -> str | None:
    """The home page of a listed website: 'https://x.com/contact/' -> 'https://x.com/'; 'x.com/a' -> 'x.com'."""
    if not website:
        return None
    w = website.strip()
    if "://" in w:
        parts = urlsplit(w)
        return f"{parts.scheme}://{parts.netloc}/" if parts.netloc else None
    return w.split("/", 1)[0] or None


def lead_listing_info(lead: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": lead["name"], "category_label": lead["category_label"], "address": lead["address"],
        "website": lead["website"], "city": lead["listing"].get("city"), "region": lead["listing"].get("region"),
    }


async def _research_by_search(app: AppState, lead: dict[str, Any], offer: dict[str, Any], rel: str | None) -> dict[str, Any] | None:
    lead_id = lead["id"]
    if await aupdate_lead(app, lead_id, stage_label="Searching the web") is None:
        return None
    try:
        rr = await researcher_role.research_search(app.ai, _ctx("researcher", lead=lead), listing=lead_listing_info(lead), offer=offer)
    except AIRequestError as exc:
        if "web_search" in str(exc).lower() or "web search" in str(exc).lower():
            app.web_search_state = "unavailable"
        await app.alog_error("pipeline", f"Web search research failed: {exc}", lead_id=lead_id)
        await _replace(app, lead, "No website, and web search couldn't verify it")
        return None
    app.web_search_state = "available"
    v = rr.out.verification
    if v.closed_signal or v.operating == "no":
        await _replace(app, lead, "Looked closed: " + (v.note or "a search result says it closed"))
        return None
    if v.operating != "yes" or not rr.search_results:
        await _replace(app, lead, "No website, and no current page about it turned up")
        return None
    urls = {normalize_url(r["url"]): r for r in rr.search_results}
    facts = []
    for fo in rr.out.facts[:8]:
        r = urls.get(normalize_url(fo.url))
        if r is None:
            continue
        facts.append({"text": fo.text[:300], "quote": fo.quote[:400], "source_kind": "search", "origin": "research",
                      "url": r["url"], "source_label": f"Web search result: {(r.get('title') or r['url'])[:60]}",
                      "seen_at": utcnow(), "quote_found": False})
    facts.append(_listing_fact(lead, rel))
    contact = find_contact(listing_emails=list(lead["listing"].get("emails") or []), website=None, pages=[],
                           listing_label=listing_label(rel))
    return await _commit_research(
        app, lead_id, facts, status="choosing", step=2, stage_label="Choosing hook", contact=contact.to_dict(),
        verification={"status": "verified", "note": v.note or "A current web page mentions this business.", "url": facts[0]["url"] if facts and facts[0].get("url") else None},
        summary=rr.out.summary[:500] if rr.out.summary else None, owner_name=rr.out.owner_name,
        pages_read=[{"url": r["url"], "label": f"Search result: {(r.get('title') or '')[:40]}", "fetched_at": iso(utcnow())}
                    for r in rr.search_results[:5]],
    )


def build_research_facts(out: Any, pages: list[PageResult]) -> list[dict[str, Any]]:
    by_url: dict[str, PageResult] = {}
    for p in pages:
        if p.ok:
            by_url[normalize_url(p.final_url)] = p
            by_url.setdefault(normalize_url(p.url), p)
    facts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for fo in out.facts[:12]:
        page = by_url.get(normalize_url(fo.url))
        if page is None or not fo.text:
            continue  # facts may only link to pages we fetched (RE4)
        key = fo.text.lower()
        if key in seen:
            continue
        seen.add(key)
        found = bool(fo.quote) and (quote_in_text(fo.quote, page.text or "") or quote_in_text(fo.quote, mask_contacts(page.text or "")))
        facts.append({
            "text": fo.text[:300], "quote": fo.quote[:400], "source_kind": "site", "origin": "research",
            "url": page.final_url, "source_label": page_label(page.final_url, page.title),
            "seen_at": page.fetched_at.replace(tzinfo=None) if page.fetched_at else utcnow(), "quote_found": found,
        })
    return facts[:8]


def site_check_facts(sc: Any, home: PageResult) -> list[dict[str, Any]]:
    year = date.today().year
    items: list[str] = []
    if sc.secure is False:
        items.append("The website doesn't use a secure (https) connection.")
    if sc.mobile_ready is False:
        items.append("The home page has no mobile viewport setting, so it may not fit phone screens.")
    if sc.online_booking is False:
        items.append("We found no online booking option on the pages we read.")
    if sc.hours is False:
        items.append("We didn't find business hours on the pages we read.")
    if sc.copyright_year and sc.copyright_year <= year - 2:
        items.append(f"The home page footer shows a copyright year of {sc.copyright_year}.")
    if sc.load_seconds and sc.load_seconds >= 4:
        items.append(f"The home page took {sc.load_seconds:.1f} seconds to load when we checked.")
    if sc.online_booking is True:
        items.append("The website offers online booking.")
    return [
        {"text": t, "quote": "", "source_kind": "site", "origin": "site_check", "url": home.final_url,
         "source_label": "Site check of the home page", "seen_at": utcnow(), "quote_found": True}
        for t in items
    ]


def _listing_fact(lead: dict[str, Any], release: str | None) -> dict[str, Any]:
    cat = (lead["category_label"] or "business").lower()
    where = lead["locality"] or "the area"
    return {"text": f"Listed as a {cat} in {where}.", "quote": "", "source_kind": "listing", "origin": "listing",
            "url": None, "source_label": listing_label(release), "seen_at": utcnow(), "quote_found": True}


def _replace_facts(s: Session, lead_id: str, facts: list[dict[str, Any]]) -> None:
    for f in s.scalars(select(Fact).where(Fact.lead_id == lead_id)).all():
        s.delete(f)
    s.flush()
    for n, f in enumerate(facts, 1):
        s.add(Fact(lead_id=lead_id, n=n, **f))


def prompt_facts(s: Session, lead_id: str) -> tuple[list[PromptFact], dict[str, str], dict[str, str]]:
    """Facts the writer may use, numbered F1.. Returns (facts, pid→db id, db id→pid)."""
    rows = s.scalars(select(Fact).where(Fact.lead_id == lead_id).order_by(Fact.n)).all()
    usable = [f for f in rows if not f.flagged_wrong and (f.quote_found or f.source_kind == "search")]
    out: list[PromptFact] = []
    pid_to_db: dict[str, str] = {}
    db_to_pid: dict[str, str] = {}
    for i, f in enumerate(usable, 1):
        pid = f"F{i}"
        if f.origin == "site_check":
            source = "our site check of the home page"
        elif f.source_kind == "listing":
            source = f.source_label
        elif f.source_kind == "search":
            source = f"{f.source_label} ({f.url})"
        else:
            source = f"{f.source_label} ({f.url})"
        out.append(PromptFact(pid=pid, text=f.text, quote=f.quote, source=source))
        pid_to_db[pid] = f.id
        db_to_pid[f.id] = pid
    return out, pid_to_db, db_to_pid


async def strategy_stage(app: AppState, lead: dict[str, Any]) -> dict[str, Any] | None:
    lead_id = lead["id"]
    if await aupdate_lead(app, lead_id, status="choosing", step=2, stage_label="Choosing hook") is None:
        return None
    offer = await app.db.arun(lambda s: dict(s.get(Campaign, lead["campaign_id"]).input))
    facts, pid_to_db, _ = await app.db.arun(lambda s: prompt_facts(s, lead_id))
    st, _ = await writer_role.strategy(app.ai, _ctx("writer", lead=lead), business=business_info(lead), offer=offer, facts=facts)
    hooks = []
    for i, h in enumerate([st.hook, *st.alternatives], 1):
        hooks.append({"id": f"h{i}", "kind": h.kind, "title": h.title, "reason": h.reason,
                      "fact_ids": [pid_to_db[p] for p in h.fact_ids if p in pid_to_db]})
    return await aupdate_lead(app, lead_id, status="writing", step=3, stage_label="Writing", hooks=hooks,
                              fit_score=st.fit_score, fit_reason=st.fit_reason)


def hook_out(h: dict[str, Any], db_to_pid: dict[str, str]) -> HookOut:
    return HookOut(kind=h.get("kind", "other"), title=h.get("title", ""), reason=h.get("reason", ""),
                   fact_ids=[db_to_pid[i] for i in h.get("fact_ids", []) if i in db_to_pid])


def sender_info(user: User | None) -> dict[str, Any]:
    p = (user.profile if user else None) or {}
    return {"sender_name": p.get("sender_name", ""), "sender_company": p.get("sender_company", "")}


async def writing_stage(app: AppState, lead: dict[str, Any]) -> dict[str, Any] | None:
    lead_id = lead["id"]
    if await aupdate_lead(app, lead_id, status="writing", step=3, stage_label="Writing") is None:
        return None

    def load(s: Session):
        c = s.get(Campaign, lead["campaign_id"])
        u = s.get(User, lead["user_id"])
        return dict(c.input), sender_info(u), prompt_facts(s, lead_id)

    offer, sender, (facts, pid_to_db, db_to_pid) = await app.db.arun(load)
    hooks = lead.get("hooks") or []
    if not hooks:
        return await aupdate_lead(app, lead_id, status="choosing", step=2, stage_label="Choosing hook")
    email, _ = await writer_role.write_email(
        app.ai, _ctx("writer", lead=lead), business=business_info(lead), offer=offer, sender=sender,
        facts=facts, hook=hook_out(hooks[0], db_to_pid),
    )

    def save(s: Session, ld: Lead) -> dict[str, Any]:
        ld.email_version_id = save_version(s, lead_id, email, pid_to_db, origin="draft", detail=None)
        ld.previous_version_id = None
        ld.drafted_at = utcnow()
        ld.status, ld.step, ld.stage_label = "checking", 4, "Checking"
        ld.updated_at = utcnow()
        s.flush()
        app.publish_lead(s, ld)
        return lead_snapshot(ld)
    _ran, snap = await guarded(app, lead_id, save)
    return snap


def save_version(s: Session, lead_id: str, email: EmailOut, pid_to_db: dict[str, str], *, origin: str,
                 detail: str | None, verdicts: dict[int, bool] | None = None) -> str:
    paragraphs = []
    n = 0
    for para in email.paragraphs:
        out = []
        for sent in para:
            n += 1
            out.append({
                "id": f"s{n}", "text": sent.text, "kind": sent.kind,
                "fact_ids": [pid_to_db[p] for p in sent.fact_ids if p in pid_to_db] if sent.kind == "claim" else [],
                "verified": (verdicts or {}).get(n), "edited": False,
            })
        paragraphs.append(out)
    v = EmailVersion(lead_id=lead_id, subject=email.subject, greeting=email.greeting, paragraphs=paragraphs,
                     signoff=email.signoff or "Best,", origin=origin, origin_detail=detail)
    s.add(v)
    s.flush()
    _trim_versions(s, lead_id)
    return v.id


def _trim_versions(s: Session, lead_id: str, keep: int = 5) -> None:
    lead = s.get(Lead, lead_id)
    protected = {lead.email_version_id, lead.previous_version_id} if lead else set()
    rows = s.scalars(select(EmailVersion).where(EmailVersion.lead_id == lead_id).order_by(EmailVersion.created_at.desc())).all()
    for v in rows[keep:]:
        if v.id not in protected:
            s.delete(v)


def version_to_email(v: EmailVersion, db_to_pid: dict[str, str]) -> EmailOut:
    return EmailOut(
        subject=v.subject, greeting=v.greeting, signoff=v.signoff,
        paragraphs=[[SentenceOut(text=s["text"], kind=s.get("kind", "other"),
                                 fact_ids=[db_to_pid[i] for i in s.get("fact_ids", []) if i in db_to_pid])
                     for s in para] for para in (v.paragraphs or [])],
    )


def code_issues_for(email: EmailOut, business_name: str, known: set[str]) -> list[emailtext.RuleIssue]:
    paragraphs = [[{"text": s.text, "fact_ids": s.fact_ids, "kind": s.kind} for s in p] for p in email.paragraphs]
    return emailtext.rule_checks(subject=email.subject, greeting=email.greeting, paragraphs=paragraphs,
                                 signoff=email.signoff, business_name=business_name, known_fact_ids=known)


async def run_editor(app: AppState, lead: dict[str, Any], email: EmailOut, facts: list[PromptFact],
                     offer: dict[str, Any], *, max_fixes: int = 2) -> tuple[EmailOut, dict[str, Any], dict[int, bool], bool, bool]:
    """Check (and fix up to `max_fixes` times).
    Returns (final email, editor record, verdicts by sentence number, all_ok, applied_a_fix)."""
    known = {f.pid for f in facts}
    fixes: list[str] = []
    record: dict[str, Any] = {}
    verdicts: dict[int, bool] = {}
    all_ok = False
    applied = False
    for round_no in range(max_fixes + 1):
        issues = code_issues_for(email, lead["name"], known)
        verdict, ids, _ = await editor_role.check(
            app.ai, _ctx("editor", lead=lead), business=business_info(lead), offer=offer, facts=facts,
            email=email, code_issues=[i.message for i in issues],
        )
        by_id = {v.id: v for v in verdict.sentences}
        verdicts = {n: bool(by_id[sid].supported) for n, sid in enumerate(ids, 1) if sid in by_id}
        checks = {k: {"passed": getattr(verdict.checks, k).passed, "note": getattr(verdict.checks, k).note}
                  for k in ("facts", "rules", "spam", "subject")}
        for issue in issues:  # our code measures length and the hard rules; it is authoritative
            checks[issue.key] = {"passed": False, "note": issue.message}
        sentences = [s for p in email.paragraphs for s in p]
        claims_ok = all(verdicts.get(n, False) for n, s in enumerate(sentences, 1) if s.kind == "claim" and s.fact_ids)
        no_source = any(s.kind == "claim" and not s.fact_ids for s in sentences)
        all_ok = all(c["passed"] for c in checks.values()) and claims_ok and not no_source
        failing = [f"{k}: {c['note']}" for k, c in checks.items() if not c["passed"] and c.get("note")]
        record = {"checks": checks, "fixes": list(fixes), "notes": "; ".join(failing) or None}
        if all_ok or verdict.fixed_email is None or round_no == max_fixes:
            break
        fixes.extend(verdict.fixes or ["Revised the draft to fix the problems the editor found."])
        email = verdict.fixed_email
        applied = True
    record["fixes"] = fixes
    return email, record, verdicts, all_ok, applied


async def editor_stage(app: AppState, lead: dict[str, Any]) -> dict[str, Any] | None:
    lead_id = lead["id"]
    if await aupdate_lead(app, lead_id, status="checking", step=4, stage_label="Checking") is None:
        return None

    def load(s: Session):
        c = s.get(Campaign, lead["campaign_id"])
        v = s.get(EmailVersion, lead["email_version_id"]) if lead["email_version_id"] else None
        facts, pid_to_db, db_to_pid = prompt_facts(s, lead_id)
        return dict(c.input), facts, pid_to_db, db_to_pid, (version_to_email(v, db_to_pid) if v else None)

    offer, facts, pid_to_db, db_to_pid, email = await app.db.arun(load)
    if email is None:
        return await aupdate_lead(app, lead_id, status="writing", step=3, stage_label="Writing")
    try:
        final, record, verdicts, all_ok, applied = await run_editor(app, lead, email, facts, offer)
    except (AIRequestError, StructuredOutputError) as exc:
        await app.alog_error("pipeline", f"Editor check failed: {exc}", lead_id=lead_id)
        record = {"checks": {k: {"passed": False, "note": "The editor couldn't check this email."} for k in ("facts", "rules", "spam", "subject")},
                  "fixes": [], "notes": "The editor couldn't check this email; check each fact against its source."}
        final, verdicts, all_ok, applied = email, {}, False, False

    def save(s: Session, ld: Lead) -> dict[str, Any]:
        if applied:  # the editor revised the text: keep its version, with its verdicts
            ld.email_version_id = save_version(s, lead_id, final, pid_to_db, origin="draft",
                                               detail="fixed by the editor", verdicts=verdicts)
        else:
            v = s.get(EmailVersion, ld.email_version_id)
            if v is not None:
                paras = []
                n = 0
                for para in v.paragraphs or []:
                    out = []
                    for sent in para:
                        n += 1
                        out.append({**sent, "verified": verdicts.get(n)})
                    paras.append(out)
                v.paragraphs = paras
        ld.editor = record
        ld.status = "ready" if all_ok else "needs_review"
        ld.step = None
        ld.stage_label = None
        ld.ready_at = utcnow()
        if not ld.counted:
            ld.counted = True
            ld.counted_at = utcnow()
        refresh_derived(s, ld)
        ld.updated_at = utcnow()
        s.flush()
        app.publish_lead(s, ld)
        return lead_snapshot(ld)
    _ran, snap = await guarded(app, lead_id, save)
    return snap


def refresh_derived(s: Session, lead: Lead) -> None:
    """After any change to the email or its facts: mark which facts the editor confirmed (Supported),
    and store whether the lead has warnings, so lists, live updates and the detail view agree."""
    s.flush()
    v = s.get(EmailVersion, lead.email_version_id) if lead.email_version_id else None
    supported: set[str] = set()
    if v is not None:
        for para in v.paragraphs or []:
            for sent in para:
                if sent.get("kind") == "claim" and sent.get("verified") and not sent.get("edited"):
                    supported.update(sent.get("fact_ids", []))
    for f in s.scalars(select(Fact).where(Fact.lead_id == lead.id)).all():
        f.supported = f.id in supported
    s.flush()
    lead.has_warnings = bool(serialize.compute_warnings(s, lead))
