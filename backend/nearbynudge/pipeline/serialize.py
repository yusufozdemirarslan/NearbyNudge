"""Turn database rows into API shapes (docs/api-types.ts)."""

from __future__ import annotations

import math
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import emailtext
from ..db import iso, utcnow
from ..listings.keys import display_phone
from ..models import Campaign, EmailVersion, Fact, Lead, LeadAction
from ..reader import text_fragment_url

IN_PROGRESS = ("queued", "reading", "choosing", "writing", "checking")
VISIBLE_EXCLUDE = ("replaced",)
STAGES = {
    "queued": ("Queued", None),
    "reading": ("Reading site", 1),
    "choosing": ("Choosing hook", 2),
    "writing": ("Writing", 3),
    "checking": ("Checking", 4),
}
CHECK_LABELS = {
    "facts": "Facts match evidence",
    "rules": "Writing rules",
    "spam": "No placeholders or spam",
    "subject": "Honest subject",
}


def fit_label(score: int | None) -> str | None:
    if score is None:
        return None
    if score >= 80:
        return "Strong"
    if score >= 60:
        return "Good"
    return "Weak"


def lead_fit(lead: Lead) -> int | None:
    return lead.fit_score if lead.fit_score is not None else lead.scout_score


def sentence_state(s: dict[str, Any], facts: dict[str, Fact]) -> str:
    if s.get("kind") != "claim":
        return "none"
    ids = [i for i in s.get("fact_ids", []) if i in facts]
    if not ids:
        return "no_source"
    if s.get("edited"):
        return "check"
    if not s.get("verified"):
        return "check"
    if any(facts[i].flagged_wrong or not facts[i].quote_found for i in ids):
        return "check"
    return "supported"


def email_dict(v: EmailVersion | None, facts: dict[str, Fact], footer: str) -> dict[str, Any] | None:
    if v is None:
        return None
    paragraphs = []
    for para in v.paragraphs or []:
        out = []
        for s in para:
            out.append(
                {
                    "id": s.get("id") or "",
                    "text": s.get("text", ""),
                    "kind": s.get("kind", "other"),
                    "fact_ids": [i for i in s.get("fact_ids", []) if i in facts],
                    "state": sentence_state(s, facts),
                    "edited": bool(s.get("edited")),
                }
            )
        if out:
            paragraphs.append(out)
    return {
        "version_id": v.id,
        "subject": v.subject,
        "greeting": v.greeting,
        "paragraphs": paragraphs,
        "signoff": v.signoff,
        "footer": footer,
        "word_count": emailtext.email_word_count(v.greeting, v.paragraphs or [], v.signoff),
        "subject_word_count": emailtext.count_words(v.subject),
        "edited": any(s.get("edited") for p in (v.paragraphs or []) for s in p),
        "origin": v.origin if v.origin in ("draft", "rewrite", "edit", "restore") else "draft",
        "origin_detail": v.origin_detail,
        "created_at": iso(v.created_at),
    }


def fact_dict(f: Fact, used: set[str]) -> dict[str, Any]:
    fragment = None
    if f.url and f.quote and f.source_kind == "site" and f.origin == "research":
        try:
            fragment = text_fragment_url(f.url, f.quote)
        except Exception:  # noqa: BLE001
            fragment = f.url
    return {
        "id": f.id,
        "text": f.text,
        "quote": f.quote,
        "source_kind": f.source_kind if f.source_kind in ("site", "listing", "search") else "site",
        "url": f.url,
        "fragment_url": fragment,
        "source_label": f.source_label,
        "seen_at": iso(f.seen_at),
        "state": "supported" if (f.supported and f.quote_found and not f.flagged_wrong) else "check",
        "quote_found": f.quote_found,
        "flagged_wrong": f.flagged_wrong,
        "used": f.id in used,
    }


def subjects_for(db: Session, leads: list[Lead]) -> dict[str, str]:
    ids = [ld.email_version_id for ld in leads if ld.email_version_id]
    if not ids:
        return {}
    rows = db.execute(select(EmailVersion.id, EmailVersion.subject).where(EmailVersion.id.in_(ids))).all()
    by_version = {r[0]: r[1] for r in rows}
    return {ld.id: by_version[ld.email_version_id] for ld in leads if ld.email_version_id in by_version}


def lead_summary(lead: Lead, subject: str | None, has_warnings: bool | None = None) -> dict[str, Any]:
    label, step = STAGES.get(lead.status, (None, None))
    stage_label = lead.stage_label or label if lead.status in IN_PROGRESS else None
    score = lead_fit(lead)
    contact_kind = (lead.contact or {}).get("kind") if lead.contact else None
    return {
        "id": lead.id,
        "campaign_id": lead.campaign_id,
        "name": lead.name,
        "category_label": lead.category_label or "",
        "locality": lead.locality or "",
        "distance_mi": round(lead.distance_mi or 0.0, 1),
        "status": lead.status if lead.status != "replaced" else "failed",
        "stage_label": stage_label,
        "step": step if lead.status in IN_PROGRESS else None,
        "fit_score": score,
        "fit_label": fit_label(score),
        "contact_kind": contact_kind,
        "email_subject": subject,
        "has_warnings": bool(lead.has_warnings) if has_warnings is None else has_warnings,
        "created_at": iso(lead.created_at),
        "updated_at": iso(lead.updated_at),
    }


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def lead_warnings(lead: Lead, email: dict[str, Any] | None, editor: dict[str, Any] | None) -> list[str]:
    warnings: list[str] = []
    if email:
        states = [s["state"] for p in email["paragraphs"] for s in p]
        n_check = states.count("check")
        n_nosrc = states.count("no_source")
        if n_check:
            warnings.append(f"{n_check} {_plural(n_check, 'sentence needs', 'sentences need')} checking against its source")
        if n_nosrc:
            warnings.append(f"{n_nosrc} {_plural(n_nosrc, 'claim has', 'claims have')} no source")
        wc = email["word_count"]
        if wc < emailtext.WORD_MIN or wc > emailtext.WORD_MAX:
            warnings.append(f"The email has {wc} words; aim for {emailtext.WORD_MIN}-{emailtext.WORD_MAX}")
        if email["subject_word_count"] > emailtext.SUBJECT_MAX_WORDS:
            warnings.append(f"The subject has {email['subject_word_count']} words; keep it under 10")
    if editor:
        for c in editor.get("checks", []):
            if not c.get("passed"):
                warnings.append(f"Editor: {c.get('label')}{' - ' + c['note'] if c.get('note') else ''}")
    for w in lead.warnings or []:
        if w not in warnings:
            warnings.append(w)
    return warnings


def lead_full(db: Session, lead: Lead, *, footer: str, model: str) -> dict[str, Any]:
    facts_rows = db.scalars(select(Fact).where(Fact.lead_id == lead.id).order_by(Fact.n)).all()
    facts = {f.id: f for f in facts_rows}
    version = db.get(EmailVersion, lead.email_version_id) if lead.email_version_id else None
    previous = db.get(EmailVersion, lead.previous_version_id) if lead.previous_version_id else None
    email = email_dict(version, facts, footer)
    prev_email = email_dict(previous, facts, footer)
    used: set[str] = set()  # facts cited by the current email (the contract's meaning of "used")
    if email:
        for p in email["paragraphs"]:
            for s in p:
                used.update(s["fact_ids"])
    used = {i for i in used if not facts[i].flagged_wrong}
    hooks = lead.hooks or []
    hook = hooks[0] if hooks else None
    alternatives = hooks[1:3] if len(hooks) > 1 else []

    versions = db.scalars(
        select(EmailVersion).where(EmailVersion.lead_id == lead.id).order_by(EmailVersion.created_at.desc()).limit(5)
    ).all()
    editor = editor_report(lead)
    warnings = lead_warnings(lead, email, editor)
    summary = lead_summary(lead, version.subject if version else None, has_warnings=bool(warnings))

    contact = None
    if lead.contact:
        c = lead.contact
        contact = {
            "kind": c.get("kind", "none"),
            "email": c.get("email"),
            "form_url": c.get("form_url"),
            "source_kind": c.get("source_kind"),
            "source_url": c.get("source_url"),
            "source_label": c.get("source_label"),
            "seen_at": c.get("seen_at"),
            "note": c.get("note"),
        }
    mailto = None
    copy = None
    if version is not None:
        copy = emailtext.copy_text(version.subject, version.greeting, version.paragraphs or [], version.signoff, footer)
        if contact and contact["kind"] == "email" and contact["email"]:
            mailto = emailtext.mailto_url(
                contact["email"], version.subject,
                emailtext.full_text(version.greeting, version.paragraphs or [], version.signoff, footer),
            )
    action = db.scalars(
        select(LeadAction)
        .where(LeadAction.lead_id == lead.id, LeadAction.undone_at.is_(None))
        .order_by(LeadAction.created_at.desc())
        .limit(1)
    ).first()
    listing = lead.listing or {}
    provenance = None
    if lead.pages_read or version is not None:
        provenance = {
            "model": model,
            "pages": [
                {"url": p.get("url", ""), "label": p.get("label", ""), "fetched_at": p.get("fetched_at", "")}
                for p in (lead.pages_read or [])
            ],
            "drafted_at": iso(lead.drafted_at),
            "checks_passed": editor["passed"] if editor else 0,
            "checks_total": editor["total"] if editor else 4,
        }
    verification = lead.verification
    return {
        **summary,
        "address": lead.address or "",
        "website": display_url(lead.website),
        "phone": display_phone(lead.phone),
        "listing": {
            "dataset": "Overture Maps Places",
            "release": listing.get("release") or "",
            "updated_at": listing.get("source_updated"),
        },
        "fit_reason": lead.fit_reason or lead.scout_reason,
        "verification": (
            {"status": verification.get("status", "unverified"), "note": verification.get("note", ""), "url": verification.get("url")}
            if verification else None
        ),
        "contact": contact,
        "facts": [fact_dict(f, used) for f in facts_rows],
        "site_check": lead.site_check,
        "hook": _hook_out(hook, facts),
        "alternatives": [h for h in (_hook_out(a, facts) for a in alternatives) if h],
        "email": email,
        "previous_email": prev_email,
        "versions": [
            {"version_id": v.id, "origin": v.origin if v.origin in ("draft", "rewrite", "edit", "restore") else "draft",
             "origin_detail": v.origin_detail, "created_at": iso(v.created_at)}
            for v in versions
        ],
        "editor": editor,
        "warnings": warnings,
        "provenance": provenance,
        "skip_reason": lead.skip_reason,
        "approved_at": iso(lead.approved_at),
        "sent_at": iso(lead.sent_at),
        "replied_at": iso(lead.replied_at),
        "reply_outcome": lead.reply_outcome,
        "error": lead.error,
        "can_retry": lead.status in ("failed", "needs_review"),
        "mailto_url": mailto,
        "copy_text": copy,
        "last_action": (
            {"action_id": action.id, "action": action.action, "created_at": iso(action.created_at)} if action else None
        ),
        "cost_usd": round(lead.cost_usd or 0.0, 4),
    }


def display_url(url: str | None) -> str | None:
    """A link-safe absolute web address for the dashboard (bare domains get https://)."""
    if not url:
        return None
    u = url.strip()
    if u.lower().startswith(("http://", "https://")):
        return u
    if "://" in u or u.lower().startswith(("javascript:", "data:", "mailto:")):
        return None
    return "https://" + u.lstrip("/")


def editor_report(lead: Lead) -> dict[str, Any] | None:
    if not lead.editor:
        return None
    checks = [
        {"key": k, "label": CHECK_LABELS[k], "passed": bool(c.get("passed")), "note": c.get("note")}
        for k, c in ((k, lead.editor.get("checks", {}).get(k, {})) for k in ("facts", "rules", "spam", "subject"))
    ]
    return {
        "checks": checks,
        "passed": sum(1 for c in checks if c["passed"]),
        "total": len(checks),
        "fixes": list(lead.editor.get("fixes", [])),
        "notes": lead.editor.get("notes"),
    }


def compute_warnings(db: Session, lead: Lead) -> list[str]:
    """The same warnings the detail view shows (used to keep Lead.has_warnings current)."""
    facts = {f.id: f for f in db.scalars(select(Fact).where(Fact.lead_id == lead.id)).all()}
    version = db.get(EmailVersion, lead.email_version_id) if lead.email_version_id else None
    return lead_warnings(lead, email_dict(version, facts, ""), editor_report(lead))


def _hook_out(h: dict[str, Any] | None, facts: dict[str, Fact]) -> dict[str, Any] | None:
    if not h:
        return None
    return {
        "id": h.get("id", "h1"),
        "kind": h.get("kind", "other"),
        "title": h.get("title", ""),
        "reason": h.get("reason", ""),
        "fact_ids": [i for i in h.get("fact_ids", []) if i in facts and not facts[i].flagged_wrong],
    }


# ---------- campaigns ----------

def campaign_counts(db: Session, campaign_id: str) -> dict[str, int]:
    rows = db.execute(
        select(Lead.status, func.count()).where(Lead.campaign_id == campaign_id).group_by(Lead.status)
    ).all()
    by = {r[0]: r[1] for r in rows}
    counts = {
        "in_progress": sum(by.get(s, 0) for s in IN_PROGRESS),
        "ready": by.get("ready", 0),
        "needs_review": by.get("needs_review", 0),
        "approved": by.get("approved", 0),
        "sent": by.get("sent", 0) + by.get("replied", 0),
        "replied": by.get("replied", 0),
        "skipped": by.get("skipped", 0),
        "dnc": by.get("dnc", 0),
        "failed": by.get("failed", 0),
        "replaced": by.get("replaced", 0),
    }
    counts["total"] = sum(v for k, v in by.items() if k != "replaced")
    return counts


def eta_seconds(db: Session, c: Campaign, counts: dict[str, int], concurrency: int) -> int | None:
    if c.status not in ("finding", "researching") or counts["in_progress"] == 0:
        return None
    rows = db.execute(
        select(Lead.started_at, Lead.ready_at).where(
            Lead.campaign_id == c.id, Lead.ready_at.is_not(None), Lead.started_at.is_not(None)
        )
    ).all()
    durations = [(r[1] - r[0]).total_seconds() for r in rows if r[1] and r[0]]
    avg = (sum(durations) / len(durations)) if durations else 75.0
    waves = math.ceil(counts["in_progress"] / max(1, concurrency))
    return int(max(10, waves * avg))


def campaign_summary(db: Session, c: Campaign, *, paused_message: str | None, concurrency: int) -> dict[str, Any]:
    counts = campaign_counts(db, c.id)
    status = c.status
    detail = c.status_detail
    if paused_message and status in ("finding", "researching"):
        status = "paused"
        detail = paused_message
    return {
        "id": c.id,
        "name": c.name,
        "location_label": c.location_label,
        "radius_mi": c.radius_mi,
        "industry": c.industry,
        "status": status,
        "status_detail": detail,
        "lead_target": c.lead_target,
        "counts": counts,
        "eta_seconds": eta_seconds(db, c, counts, concurrency) if not paused_message else None,
        "created_at": iso(c.created_at),
        "finished_at": iso(c.finished_at),
    }


def campaign_full(db: Session, c: Campaign, *, paused_message: str | None, concurrency: int) -> dict[str, Any]:
    summary = campaign_summary(db, c, paused_message=paused_message, concurrency=concurrency)
    qa = None
    if c.question and c.answer in ("yes", "no"):
        qa = {"text": c.question.get("text", ""), "answer": c.answer}
    return {
        **summary,
        "input": c.input,
        "restatement": c.restatement or "",
        "categories": c.categories or [],
        "question_answer": qa,
        "notices": list(c.notices or []),
        "finish_summary": c.finish,
        "cost_usd": round(c.cost_usd or 0.0, 4),
    }


def now_iso() -> str:
    return iso(utcnow()) or ""
