"""What users do to leads: approve, skip, do not contact, mark sent, replied, undo, edit, rewrite, retry."""

from __future__ import annotations

import difflib
import threading
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import emailtext
from ..db import iso, utcnow
from ..models import Campaign, DncEntry, EmailVersion, Fact, Lead, LeadAction, Page, User
from ..roles import writer as writer_role
from ..roles.skills import PromptFact
from . import jobs, steps
from .serialize import IN_PROGRESS
from .state import AppState

SNAPSHOT_FIELDS = ("status", "approved_at", "sent_at", "replied_at", "reply_outcome", "skip_reason", "dnc_at")
_SEND_LOCK = threading.Lock()  # check-then-mark for the daily cap happens one request at a time
DATETIME_FIELDS = {"approved_at", "sent_at", "replied_at", "dnc_at"}


class ActionError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _snap(lead: Lead) -> dict[str, Any]:
    out = {}
    for f in SNAPSHOT_FIELDS:
        v = getattr(lead, f)
        out[f] = iso(v) if f in DATETIME_FIELDS else v
    return out


def _restore(lead: Lead, snap: dict[str, Any]) -> None:
    for f in SNAPSHOT_FIELDS:
        v = snap.get(f)
        if f in DATETIME_FIELDS:
            v = datetime.fromisoformat(v.replace("Z", "")) if v else None
        setattr(lead, f, v)


def user_tz(user: User) -> ZoneInfo:
    tz = ((user.profile or {}).get("timezone")) or "America/New_York"
    try:
        return ZoneInfo(tz)
    except Exception:  # noqa: BLE001
        return ZoneInfo("America/New_York")


def local_day_bounds(user: User) -> tuple[datetime, datetime]:
    tz = user_tz(user)
    now_local = datetime.now(tz)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    to_utc = lambda d: d.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)  # noqa: E731
    return to_utc(start_local), to_utc(end_local)


def sending_today(s: Session, user: User, cap: int) -> dict[str, Any]:
    start, end = local_day_bounds(user)
    n = s.scalar(
        select(func.count()).select_from(Lead).where(
            Lead.user_id == user.id, Lead.sent_at >= start, Lead.sent_at < end, Lead.status.in_(("sent", "replied"))
        )
    ) or 0
    return {"sent_today": int(n), "daily_cap": cap, "resets_at": iso(end)}


def _record(app: AppState, s: Session, lead: Lead, user: User, action: str, before: dict[str, Any],
            dnc_entry_id: str | None = None) -> LeadAction:
    lead.updated_at = utcnow()
    row = LeadAction(lead_id=lead.id, user_id=user.id, action=action, before=before, after=_snap(lead),
                     dnc_entry_id=dnc_entry_id)
    s.add(row)
    s.flush()
    app.publish_lead(s, lead)
    c = s.get(Campaign, lead.campaign_id)
    if c is not None:
        app.publish_campaign(s, c)
    return row


def approve(app: AppState, s: Session, lead: Lead, user: User) -> LeadAction:
    if lead.status not in ("ready", "needs_review"):
        raise ActionError(409, "conflict", "Only drafts that are ready or need review can be approved.")
    if lead.email_version_id is None:
        raise ActionError(409, "conflict", "There's no email to approve yet.")
    before = _snap(lead)
    lead.status = "approved"
    lead.approved_at = utcnow()
    return _record(app, s, lead, user, "approve", before)


def unapprove(app: AppState, s: Session, lead: Lead, user: User) -> LeadAction:
    if lead.status != "approved":
        raise ActionError(409, "conflict", "This email isn't approved.")
    before = _snap(lead)
    lead.status = "needs_review" if (lead.editor and lead.editor.get("notes")) else "ready"
    lead.approved_at = None
    return _record(app, s, lead, user, "unapprove", before)


def skip(app: AppState, s: Session, lead: Lead, user: User, reason: str) -> LeadAction:
    if lead.status in ("skipped", "dnc", "sent", "replied", "replaced"):
        raise ActionError(409, "conflict", "This lead can't be skipped now.")
    before = _snap(lead)
    lead.status = "skipped"
    lead.skip_reason = reason.strip()[:300]
    lead.step = None
    lead.stage_label = None
    row = _record(app, s, lead, user, "skip", before)
    steps.maybe_finish_campaign(app, s, lead.campaign_id)
    return row


def _add_dnc(s: Session, lead: Lead, user: User, *, source: str, reason: str | None) -> DncEntry:
    email = ((lead.contact or {}).get("email") or None)
    entry = DncEntry(user_id=user.id, business_name=lead.name, domain=lead.domain, email=email.lower() if email else None,
                     place_id=lead.place_id, reason=(reason or "").strip()[:300] or None, source=source)
    s.add(entry)
    s.flush()
    return entry


def do_not_contact(app: AppState, s: Session, lead: Lead, user: User, reason: str | None) -> LeadAction:
    if lead.status in ("dnc", "replaced"):
        raise ActionError(409, "conflict", "This business is already on your do-not-contact list.")
    before = _snap(lead)
    entry = _add_dnc(s, lead, user, source="lead", reason=reason)
    lead.status = "dnc"
    lead.dnc_at = utcnow()
    lead.step = None
    lead.stage_label = None
    row = _record(app, s, lead, user, "dnc", before, dnc_entry_id=entry.id)
    steps.maybe_finish_campaign(app, s, lead.campaign_id)
    return row


def mark_sent(app: AppState, s: Session, lead: Lead, user: User) -> LeadAction:
    if lead.status != "approved":
        raise ActionError(409, "conflict", "Approve the email before marking it sent.")
    with _SEND_LOCK:
        today = sending_today(s, user, app.settings.daily_send_cap)
        if today["sent_today"] >= today["daily_cap"]:
            raise ActionError(409, "daily_cap_reached",
                              f"You've marked {today['daily_cap']} emails as sent today. The limit resets at midnight.")
        before = _snap(lead)
        lead.status = "sent"
        lead.sent_at = utcnow()
        row = _record(app, s, lead, user, "sent", before)
        s.commit()  # make the count visible to the next request before releasing the lock
        return row


def mark_replied(app: AppState, s: Session, lead: Lead, user: User, outcome: str) -> LeadAction:
    if lead.status != "sent":
        raise ActionError(409, "conflict", "Mark the email as sent before logging a reply.")
    before = _snap(lead)
    lead.status = "replied"
    lead.replied_at = utcnow()
    lead.reply_outcome = outcome
    entry_id = None
    if outcome == "no_thanks":
        entry_id = _add_dnc(s, lead, user, source="reply", reason='Replied "no thanks"').id
    return _record(app, s, lead, user, "replied", before, dnc_entry_id=entry_id)


def undo(app: AppState, s: Session, action_id: str, user: User) -> Lead:
    row = s.get(LeadAction, action_id)
    if row is None or row.user_id != user.id:
        raise ActionError(404, "not_found", "That action wasn't found.")
    lead = s.get(Lead, row.lead_id)
    if lead is None:
        raise ActionError(404, "not_found", "That lead no longer exists.")
    if row.undone_at is not None:
        raise ActionError(409, "conflict", "That action was already undone.")
    newer = s.scalars(
        select(LeadAction.id).where(LeadAction.lead_id == lead.id, LeadAction.undone_at.is_(None),
                                    LeadAction.created_at > row.created_at).limit(1)
    ).first()
    if newer is not None or lead.status != row.after.get("status"):
        raise ActionError(409, "conflict", "This lead has changed since then, so the action can't be undone.")
    _restore(lead, row.before)
    if row.dnc_entry_id:
        entry = s.get(DncEntry, row.dnc_entry_id)
        if entry is not None:
            s.delete(entry)
    row.undone_at = utcnow()
    lead.updated_at = utcnow()
    s.flush()
    app.publish_lead(s, lead)
    c = s.get(Campaign, lead.campaign_id)
    if c is not None:
        if lead.status in IN_PROGRESS and not jobs.has_pending_lead_job(s, lead.id):
            jobs.enqueue(s, kind="lead", user_id=lead.user_id, campaign_id=lead.campaign_id, lead_id=lead.id)
            if c.status == "done":
                c.status = "researching"
                c.finished_at = None
        app.publish_campaign(s, c)
    return lead


# ---------- email edits ----------

def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def edit_email(app: AppState, s: Session, lead: Lead, user: User, subject: str, body: str) -> None:
    if lead.email_version_id is None or lead.status in IN_PROGRESS or lead.status in ("replaced",):
        raise ActionError(409, "conflict", "There's no draft to edit yet.")
    current = s.get(EmailVersion, lead.email_version_id)
    old_sentences = [sent for para in (current.paragraphs or []) for sent in para] if current else []
    by_text = {_norm(x["text"]): x for x in old_sentences}
    greeting, paragraphs, signoff = emailtext.parse_body(body)
    if not paragraphs:
        raise ActionError(422, "validation", "The email body can't be empty.")
    new_paras = []
    n = 0
    for para in paragraphs:
        out = []
        for text in para:
            n += 1
            same = by_text.get(_norm(text))
            if same is not None:
                out.append({**same, "id": f"s{n}", "text": text})
                continue
            best, ratio = None, 0.0
            for old in old_sentences:
                r = difflib.SequenceMatcher(None, _norm(old["text"]), _norm(text)).ratio()
                if r > ratio:
                    best, ratio = old, r
            if best is not None and ratio >= 0.6:
                out.append({"id": f"s{n}", "text": text, "kind": best.get("kind", "other"),
                            "fact_ids": list(best.get("fact_ids", [])), "verified": None, "edited": True})
            else:
                out.append({"id": f"s{n}", "text": text, "kind": "other", "fact_ids": [], "verified": None, "edited": True})
        new_paras.append(out)
    v = EmailVersion(lead_id=lead.id, subject=" ".join(subject.split()), greeting=greeting or (current.greeting if current else ""),
                     paragraphs=new_paras, signoff=signoff or (current.signoff if current else "Best,"),
                     origin="edit", origin_detail="edited by you")
    s.add(v)
    s.flush()
    lead.previous_version_id = None
    lead.email_version_id = v.id
    issues = emailtext.rule_checks(subject=v.subject, greeting=v.greeting, paragraphs=v.paragraphs, signoff=v.signoff,
                                   business_name=lead.name)
    edited_claims = sum(1 for p in new_paras for x in p if x.get("edited") and x.get("kind") == "claim")
    warnings = [i.message for i in issues]
    if edited_claims:
        warnings.append(f"{edited_claims} edited {'claim hasn' if edited_claims == 1 else 'claims haven'}'t been checked against sources")
    lead.warnings = warnings
    steps._trim_versions(s, lead.id)
    steps.refresh_derived(s, lead)
    lead.updated_at = utcnow()
    s.flush()
    app.publish_lead(s, lead)


def restore_version(app: AppState, s: Session, lead: Lead, version_id: str) -> None:
    v = s.get(EmailVersion, version_id)
    if v is None or v.lead_id != lead.id:
        raise ActionError(404, "not_found", "That version wasn't found.")
    if lead.status in IN_PROGRESS:
        raise ActionError(409, "conflict", "Wait until the draft is finished.")
    copy = EmailVersion(lead_id=lead.id, subject=v.subject, greeting=v.greeting, paragraphs=v.paragraphs,
                        signoff=v.signoff, origin="restore", origin_detail=f"restored the {v.origin} from {iso(v.created_at)}")
    s.add(copy)
    s.flush()
    lead.previous_version_id = None
    lead.email_version_id = copy.id
    lead.warnings = []
    steps._trim_versions(s, lead.id)
    steps.refresh_derived(s, lead)
    lead.updated_at = utcnow()
    s.flush()
    app.publish_lead(s, lead)


async def rewrite(app: AppState, lead_id: str, user_id: str, mode: str, *, hook_id: str | None = None,
                  removed_fact_id: str | None = None) -> None:
    def load(s: Session):
        lead = s.get(Lead, lead_id)
        if lead is None or lead.user_id != user_id:
            raise ActionError(404, "not_found", "That lead wasn't found.")
        if lead.status not in ("ready", "needs_review", "approved") or lead.email_version_id is None:
            raise ActionError(409, "conflict", "This email can't be rewritten right now.")
        c = s.get(Campaign, lead.campaign_id)
        u = s.get(User, user_id)
        facts, pid_to_db, db_to_pid = steps.prompt_facts(s, lead_id)
        v = s.get(EmailVersion, lead.email_version_id)
        removed = None
        if removed_fact_id:
            f = s.get(Fact, removed_fact_id)
            if f is not None:
                removed = PromptFact(pid="X1", text=f.text, quote=f.quote, source=f.source_label)
        return (steps.lead_snapshot(lead), dict(c.input), steps.sender_info(u), facts, pid_to_db, db_to_pid,
                steps.version_to_email(v, db_to_pid), lead.email_version_id, removed)

    lead, offer, sender, facts, pid_to_db, db_to_pid, current, current_id, removed = await app.db.arun(load)
    hooks = lead.get("hooks") or []
    chosen = None
    if mode == "another_hook":
        alts = hooks[1:]
        chosen = next((h for h in hooks if h.get("id") == hook_id), None) if hook_id else (alts[0] if alts else None)
        if chosen is None:
            raise ActionError(409, "no_alternative", "There's no other hook to try for this business.")
    ai_mode = "remove_fact" if removed_fact_id else mode
    new_email, _ = await writer_role.rewrite_email(
        app.ai, steps._ctx("writer", lead=lead), business=steps.business_info(lead), offer=offer, sender=sender,
        facts=facts, current=current, mode=ai_mode,
        hook=steps.hook_out(chosen, db_to_pid) if chosen else None, removed_fact=removed,
    )
    final, record, verdicts, all_ok, _applied = await steps.run_editor(app, lead, new_email, facts, offer, max_fixes=0)
    detail = {"shorter": "shorter", "friendlier": "friendlier", "more_direct": "more direct",
              "another_hook": f"another hook: {chosen['title'] if chosen else ''}"}.get(mode, mode)
    if removed_fact_id:
        detail = "removed a wrong fact"

    def save(s: Session) -> None:
        ld = s.get(Lead, lead_id)
        if ld is None:
            raise ActionError(404, "not_found", "That lead no longer exists.")
        if ld.email_version_id != current_id or ld.status not in ("ready", "needs_review", "approved"):
            raise ActionError(409, "conflict", "This lead changed while the rewrite ran, so the rewrite wasn't applied.")
        new_id = steps.save_version(s, lead_id, final, pid_to_db, origin="rewrite", detail=detail, verdicts=verdicts)
        ld.previous_version_id = current_id
        ld.email_version_id = new_id
        ld.editor = record
        ld.warnings = []
        if chosen is not None:
            ld.hooks = [chosen] + [h for h in hooks if h.get("id") != chosen.get("id")]
        if ld.status == "approved":
            ld.approved_at = None
        ld.status = "ready" if all_ok else "needs_review"
        steps.refresh_derived(s, ld)
        ld.updated_at = utcnow()
        s.flush()
        app.publish_lead(s, ld)
    await app.db.arun(save)


async def wrong_fact(app: AppState, fact_id: str, user_id: str, note: str | None) -> str:
    def flag(s: Session) -> tuple[str, bool]:
        f = s.get(Fact, fact_id)
        lead = s.get(Lead, f.lead_id) if f else None
        if f is None or lead is None or lead.user_id != user_id:
            raise ActionError(404, "not_found", "That fact wasn't found.")
        f.flagged_wrong = True
        f.flagged_note = (note or "").strip()[:500] or None
        f.supported = False
        used = False
        v = s.get(EmailVersion, lead.email_version_id) if lead.email_version_id else None
        if v is not None:
            used = any(fact_id in sent.get("fact_ids", []) for para in v.paragraphs or [] for sent in para)
        steps.refresh_derived(s, lead)
        lead.updated_at = utcnow()
        s.flush()
        app.publish_lead(s, lead)
        return lead.id, used and lead.status in ("ready", "needs_review", "approved")
    lead_id, needs_rewrite = await app.db.arun(flag)
    if needs_rewrite:
        await rewrite(app, lead_id, user_id, "shorter", removed_fact_id=fact_id)
    return lead_id


def retry(app: AppState, s: Session, lead: Lead, mode: str) -> None:
    if lead.status not in ("failed", "needs_review"):
        raise ActionError(409, "conflict", "Only leads that couldn't finish or need review can be retried.")
    if lead.status == "failed" or mode == "without_site":
        for f in s.scalars(select(Fact).where(Fact.lead_id == lead.id)).all():
            s.delete(f)
        for p in s.scalars(select(Page).where(Page.lead_id == lead.id)).all():
            s.delete(p)
        lead.status = "queued"
        lead.stage_label = "Queued"
        lead.research_mode = "without_site" if mode == "without_site" else "site"
        lead.hooks = None
        lead.contact = lead.contact if mode == "without_site" else None
        lead.site_check = None
        lead.verification = None
        lead.pages_read = []
    else:
        lead.status = "choosing"
        lead.stage_label = "Choosing hook"
        lead.step = 2
    lead.error = None
    lead.editor = None
    lead.warnings = []
    lead.updated_at = utcnow()
    s.flush()
    if not jobs.has_pending_lead_job(s, lead.id):
        jobs.enqueue(s, kind="lead", user_id=lead.user_id, campaign_id=lead.campaign_id, lead_id=lead.id)
    c = s.get(Campaign, lead.campaign_id)
    if c is not None and c.status == "done":
        c.status = "researching"
        c.finished_at = None
    app.publish_lead(s, lead)
    if c is not None:
        app.publish_campaign(s, c)
