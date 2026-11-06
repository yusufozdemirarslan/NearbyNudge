"""The monthly lead allowance and the daily send cap.

Both are counted from a usage record kept by workspace id, apart from the leads themselves, so deleting a campaign
(or all data) doesn't hand the allowance back. Undoing "sent" removes that send's row, which frees its slot again.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..db import iso, utcnow
from ..models import Campaign, Lead, LeadAction, UsageEvent, User
from .serialize import IN_PROGRESS


def user_tz(user: User) -> ZoneInfo:
    tz = ((user.profile or {}).get("timezone")) or "America/New_York"
    try:
        return ZoneInfo(tz)
    except Exception:  # noqa: BLE001
        return ZoneInfo("America/New_York")


def _utc(d: datetime) -> datetime:
    return d.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def local_day_bounds(user: User) -> tuple[datetime, datetime]:
    """Today in the workspace's time zone, as naive UTC times [start, end)."""
    start = datetime.now(user_tz(user)).replace(hour=0, minute=0, second=0, microsecond=0)
    return _utc(start), _utc(start + timedelta(days=1))


def month_bounds(user: User) -> tuple[datetime, datetime, str]:
    """This month in the workspace's time zone, as naive UTC times [start, end), and its name."""
    start = datetime.now(user_tz(user)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    nxt = (start + timedelta(days=32)).replace(day=1)
    return _utc(start), _utc(nxt), start.strftime("%B %Y")


def _count(s: Session, workspace_id: str, kind: str, start: datetime, end: datetime) -> int:
    return int(s.scalar(select(func.count()).select_from(UsageEvent).where(
        UsageEvent.workspace_id == workspace_id, UsageEvent.kind == kind,
        UsageEvent.created_at >= start, UsageEvent.created_at < end)) or 0)


def monthly_usage(s: Session, user: User, limit: int) -> dict[str, Any]:
    """Leads drafted this month, against the allowance."""
    start, end, label = month_bounds(user)
    return {"used": _count(s, user.id, "lead", start, end), "limit": limit, "month_label": label}


def reserved(s: Session, user: User, *, except_campaign: str | None = None) -> int:
    """Leads that will count soon: the ones still being researched, plus the target of every campaign that is still
    finding its businesses (it has no leads yet)."""
    researching = s.scalar(select(func.count()).select_from(Lead).where(
        Lead.user_id == user.id, Lead.counted.is_(False), Lead.status.in_(IN_PROGRESS))) or 0
    finding = select(func.coalesce(func.sum(Campaign.lead_target), 0)).where(
        Campaign.user_id == user.id, Campaign.status == "finding")
    if except_campaign is not None:
        finding = finding.where(Campaign.id != except_campaign)
    return int(researching) + int(s.scalar(finding) or 0)


def leads_left(s: Session, user: User, limit: int, *, except_campaign: str | None = None) -> tuple[dict[str, Any], int, int]:
    """(this month's usage, leads held by work still running, leads left to start)."""
    usage = monthly_usage(s, user, limit)
    held = reserved(s, user, except_campaign=except_campaign)
    return usage, held, usage["limit"] - usage["used"] - held


def limit_message(usage: dict[str, Any], held: int) -> str:
    busy = f" ({held} more are being researched now)" if held else ""
    return f"You've used {usage['used']} of {usage['limit']} leads this month{busy}. Your allowance resets next month."


def sending_today(s: Session, user: User, cap: int) -> dict[str, Any]:
    """Emails marked sent today (in the workspace's time zone), against the daily cap."""
    start, end = local_day_bounds(user)
    return {"sent_today": _count(s, user.id, "send", start, end), "daily_cap": cap, "resets_at": iso(end)}


def record_lead(s: Session, lead: Lead) -> None:
    """The lead was drafted: from now on it counts against this month's allowance."""
    s.add(UsageEvent(workspace_id=lead.user_id, kind="lead", lead_id=lead.id, created_at=lead.counted_at or utcnow()))


def record_send(s: Session, lead: Lead, action_id: str) -> None:
    """The email was marked sent (by the action `action_id`): it counts against today's sending cap."""
    s.add(UsageEvent(workspace_id=lead.user_id, kind="send", lead_id=lead.id, action_id=action_id,
                     created_at=lead.sent_at or utcnow()))


def undo_send(s: Session, action_id: str) -> None:
    """Undoing "sent" gives its slot back."""
    s.execute(delete(UsageEvent).where(UsageEvent.kind == "send", UsageEvent.action_id == action_id))


def backfill(s: Session) -> int:
    """For a database made before the usage record: count the leads already drafted and the emails already marked
    sent, once each (it is safe to run at every start). Returns the number of rows added."""
    counted = select(UsageEvent.lead_id).where(UsageEvent.kind == "lead", UsageEvent.lead_id.is_not(None))
    rows = s.execute(select(Lead.id, Lead.user_id, Lead.counted_at).where(
        Lead.counted.is_(True), Lead.id.not_in(counted))).all()
    for lead_id, workspace_id, at in rows:
        s.add(UsageEvent(workspace_id=workspace_id, kind="lead", lead_id=lead_id, created_at=at or utcnow()))
    sent = select(UsageEvent.lead_id).where(UsageEvent.kind == "send", UsageEvent.lead_id.is_not(None))
    sends = s.execute(select(Lead.id, Lead.user_id, Lead.sent_at).where(
        Lead.sent_at.is_not(None), Lead.id.not_in(sent))).all()
    for lead_id, workspace_id, at in sends:
        action_id = s.scalars(select(LeadAction.id).where(
            LeadAction.lead_id == lead_id, LeadAction.action == "sent", LeadAction.undone_at.is_(None),
        ).order_by(LeadAction.created_at.desc()).limit(1)).first()
        s.add(UsageEvent(workspace_id=workspace_id, kind="send", lead_id=lead_id, action_id=action_id, created_at=at))
    s.flush()
    return len(rows) + len(sends)
