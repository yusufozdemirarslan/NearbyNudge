"""Database tables."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, new_id, utcnow


def _id() -> Mapped[str]:
    return mapped_column(String(40), primary_key=True, default=new_id)


class User(Base):
    """A workspace: its sender profile, preferences, and (through user_id) its campaigns, leads and lists.

    There's no sign-in: the app has one built-in workspace (id "default") that everyone who opens it uses.
    Test servers can make more, one per test, through the test-only workspace switch.
    """

    __tablename__ = "users"
    id: Mapped[str] = _id()
    profile: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    preferences: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CampaignPlanRow(Base):
    __tablename__ = "campaign_plans"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    input: Mapped[dict[str, Any]] = mapped_column(JSON)
    plan: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class Campaign(Base):
    __tablename__ = "campaigns"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    location_label: Mapped[str] = mapped_column(String(200))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    radius_mi: Mapped[float] = mapped_column(Float)
    industry: Mapped[str] = mapped_column(String(200))
    input: Mapped[dict[str, Any]] = mapped_column(JSON)
    restatement: Mapped[str] = mapped_column(Text, default="")
    categories: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # PlanCategory dicts shown to the user
    include_keys: Mapped[list[str]] = mapped_column(JSON, default=list)  # final category keys searched
    question: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    answer: Mapped[str | None] = mapped_column(String(10), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="finding")
    status_detail: Mapped[str | None] = mapped_column(String(300), nullable=True)
    lead_target: Mapped[int] = mapped_column(Integer, default=10)
    notices: Mapped[list[str]] = mapped_column(JSON, default=list)
    finish: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    release: Mapped[str | None] = mapped_column(String(40), nullable=True)
    replacements_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Candidate(Base):
    __tablename__ = "candidates"
    id: Mapped[str] = _id()
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    place_id: Mapped[str] = mapped_column(String(80))
    rank: Mapped[int] = mapped_column(Integer)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="reserve")  # reserve | promoted
    listing: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Lead(Base):
    __tablename__ = "leads"
    __table_args__ = (Index("ix_leads_campaign_status", "campaign_id", "status"),)
    id: Mapped[str] = _id()
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    candidate_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    place_id: Mapped[str] = mapped_column(String(80), index=True)
    rank: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(300))
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category_label: Mapped[str] = mapped_column(String(160), default="")
    address: Mapped[str] = mapped_column(String(400), default="")
    locality: Mapped[str] = mapped_column(String(200), default="")
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_mi: Mapped[float] = mapped_column(Float, default=0.0)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(300), nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    listing: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stage_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    scout_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scout_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    fit_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fit_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    contact: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    verification: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    site_check: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    hooks: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)  # [chosen, alt1, alt2]
    email_version_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    previous_version_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    editor: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)  # extra warnings (e.g. after a user edit)
    has_warnings: Mapped[bool] = mapped_column(Boolean, default=False)  # kept in step with the detail view
    pages_read: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    research_mode: Mapped[str] = mapped_column(String(20), default="site")  # site | without_site | search

    skip_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reply_outcome: Mapped[str | None] = mapped_column(String(20), nullable=True)
    dnc_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    replaced_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    ai_requests: Mapped[int] = mapped_column(Integer, default=0)
    counted: Mapped[bool] = mapped_column(Boolean, default=False)
    counted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    drafted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Fact(Base):
    __tablename__ = "facts"
    id: Mapped[str] = _id()
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    n: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    quote: Mapped[str] = mapped_column(Text, default="")
    source_kind: Mapped[str] = mapped_column(String(20))  # site | listing | search
    origin: Mapped[str] = mapped_column(String(20), default="research")  # research | site_check | listing
    url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_label: Mapped[str] = mapped_column(String(200))
    seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    quote_found: Mapped[bool] = mapped_column(Boolean, default=False)
    supported: Mapped[bool] = mapped_column(Boolean, default=False)
    flagged_wrong: Mapped[bool] = mapped_column(Boolean, default=False)
    flagged_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Page(Base):
    __tablename__ = "pages"
    id: Mapped[str] = _id()
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(1000))
    final_url: Mapped[str] = mapped_column(String(1000))
    label: Mapped[str] = mapped_column(String(120), default="")
    title: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text: Mapped[str] = mapped_column(Text, default="")
    load_ms: Mapped[int] = mapped_column(Integer, default=0)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class EmailVersion(Base):
    __tablename__ = "email_versions"
    id: Mapped[str] = _id()
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(500))
    greeting: Mapped[str] = mapped_column(String(300), default="")
    paragraphs: Mapped[list[list[dict[str, Any]]]] = mapped_column(JSON)
    signoff: Mapped[str] = mapped_column(String(100), default="Best,")
    origin: Mapped[str] = mapped_column(String(20), default="draft")  # draft | rewrite | edit | restore
    origin_detail: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class LeadAction(Base):
    __tablename__ = "lead_actions"
    id: Mapped[str] = _id()
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(30))
    before: Mapped[dict[str, Any]] = mapped_column(JSON)
    after: Mapped[dict[str, Any]] = mapped_column(JSON)
    dnc_entry_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class LeadEvent(Base):
    __tablename__ = "lead_events"
    id: Mapped[str] = _id()
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(30))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class DncEntry(Base):
    __tablename__ = "dnc"
    id: Mapped[str] = _id()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    business_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(300), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, index=True)
    place_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="user")  # user | lead | reply
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AiCall(Base):
    __tablename__ = "ai_calls"
    id: Mapped[str] = _id()
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    user_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    campaign_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    lead_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    skill: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(60))
    thinking: Mapped[bool] = mapped_column(Boolean, default=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)  # uncached input
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)  # includes thinking
    web_searches: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(10), default="ok")
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_status_run_after", "status", "run_after"),)
    id: Mapped[str] = _id()
    kind: Mapped[str] = mapped_column(String(20))  # discover | lead
    user_id: Mapped[str] = mapped_column(String(40), index=True)
    campaign_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    lead_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | done | failed | cancelled
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    run_after: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class ErrorLog(Base):
    __tablename__ = "error_log"
    id: Mapped[str] = _id()
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    where: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(Text)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    campaign_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    lead_id: Mapped[str | None] = mapped_column(String(40), nullable=True)


class OptOut(Base):
    __tablename__ = "optouts"
    id: Mapped[str] = _id()
    domain: Mapped[str] = mapped_column(String(300), unique=True, index=True)
    contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AuditVerdict(Base):
    __tablename__ = "audit_verdicts"
    id: Mapped[str] = _id()
    fact_id: Mapped[str] = mapped_column(ForeignKey("facts.id", ondelete="CASCADE"), index=True)
    reviewer_id: Mapped[str] = mapped_column(String(40))
    verdict: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
