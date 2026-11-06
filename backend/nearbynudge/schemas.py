"""API schemas. Names and shapes mirror docs/api-types.ts exactly."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Tone = Literal["professional", "friendly", "direct"]
LeadStatus = Literal[
    "queued", "reading", "choosing", "writing", "checking", "ready", "needs_review",
    "approved", "sent", "replied", "skipped", "dnc", "failed",
]
CampaignStatus = Literal["finding", "researching", "done", "paused", "failed"]
FitLabel = Literal["Strong", "Good", "Weak"]
ContactKind = Literal["email", "form", "none"]
SourceKind = Literal["site", "listing", "search"]
SentenceKind = Literal["claim", "offer", "other"]
SentenceState = Literal["supported", "check", "no_source", "none"]
FactState = Literal["supported", "check"]
RewriteMode = Literal["shorter", "friendlier", "more_direct", "another_hook"]
ReplyOutcome = Literal["interested", "no_thanks", "other"]


class Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


MAX_RADIUS_MI = 25  # miles: the widest search a campaign can ask for


def one_line(v: Any) -> Any:
    """Single-line text with runs of whitespace collapsed and the ends trimmed. Runs before the length checks
    (mode="before"), so a field of only spaces counts as empty instead of slipping past min_length."""
    return " ".join(v.split()) if isinstance(v, str) else v


# ---------- sign-in (one account; no sign-up) ----------

class LoginRequest(Model):
    email: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=200)


class SessionResponse(Model):
    """`enabled`: this copy asks for sign-in. `signed_in` is always true when it doesn't."""
    enabled: bool
    signed_in: bool
    email: str | None = None


# ---------- the workspace ----------

class User(Model):
    """The workspace. `name` is the sender profile's name ("" until the profile is saved)."""
    id: str
    name: str
    onboarded: bool
    created_at: str


class MeResponse(Model):
    user: User


class SenderProfile(Model):
    sender_name: str = Field(min_length=1, max_length=120)
    sender_title: str = Field(default="", max_length=120)
    sender_company: str = Field(min_length=1, max_length=160)
    sender_address: str = Field(min_length=5, max_length=300)
    default_tone: Tone = "professional"
    timezone: str = Field(default="America/New_York", max_length=64)

    @field_validator("sender_name", "sender_company", "sender_title", mode="before")
    @classmethod
    def _one_line(cls, v: Any) -> Any:
        return one_line(v)

    @field_validator("sender_address")
    @classmethod
    def _address(cls, v: str) -> str:
        lines = [" ".join(line.split()) for line in v.replace("\r", "").split("\n")]
        cleaned = "\n".join(line for line in lines if line)
        if len(cleaned) < 5:
            raise ValueError("Enter your full postal address.")
        return cleaned

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        from zoneinfo import ZoneInfo

        try:
            ZoneInfo(v)
        except Exception as exc:  # noqa: BLE001
            raise ValueError("Unknown time zone.") from exc
        return v


class Preferences(Model):
    shortcuts_enabled: bool = True
    webmail_mode: bool = False
    theme: Literal["system", "light", "dark"] = "system"
    compact_rows: bool = False
    live_updates: bool = True


class Usage(Model):
    used: int
    limit: int
    month_label: str


class SendingToday(Model):
    sent_today: int
    daily_cap: int
    resets_at: str


class Account(Model):
    user: User
    profile: SenderProfile | None
    preferences: Preferences
    usage: Usage
    sending: SendingToday
    footer_preview: str | None


class DeleteAccountRequest(Model):
    """Starting over: the person types the word delete to confirm."""
    confirm: str = Field(max_length=40)


class SystemStatus(Model):
    ai_state: Literal["ok", "paused", "unconfigured"]
    ai_name: str
    ai_model: str
    message: str | None


# ---------- campaigns ----------

class CampaignInput(Model):
    location: str = Field(min_length=2, max_length=200)
    radius_mi: float = Field(default=5, ge=1, le=MAX_RADIUS_MI)
    industry: str = Field(min_length=2, max_length=120)
    offer_what: str = Field(min_length=3, max_length=400)
    offer_proof: str = Field(default="", max_length=400)
    offer_cta: str = Field(min_length=2, max_length=200)
    tone: Tone = "professional"
    lead_target: int = Field(default=10, ge=5, le=25)

    @field_validator("location", "industry", "offer_what", "offer_proof", "offer_cta", mode="before")
    @classmethod
    def _clean(cls, v: Any) -> Any:
        return one_line(v)


class PlanCategory(Model):
    key: str
    label: str
    count: int | None


class PlanLocation(Model):
    label: str
    kind: Literal["zip", "city"]
    lat: float
    lon: float
    note: str | None


class PlanQuestion(Model):
    text: str
    categories: list[PlanCategory]


class CampaignPlan(Model):
    plan_id: str
    location: PlanLocation
    restatement: str
    categories: list[PlanCategory]
    question: PlanQuestion | None
    candidate_count: int | None
    coverage: Literal["ready", "loading_needed"]
    warnings: list[str]


class CreateCampaignRequest(Model):
    plan_id: str
    input: CampaignInput
    answer: Literal["yes", "no"] | None = None


class LeadCounts(Model):
    total: int = 0
    in_progress: int = 0
    ready: int = 0
    needs_review: int = 0
    approved: int = 0
    sent: int = 0
    replied: int = 0
    skipped: int = 0
    dnc: int = 0
    failed: int = 0
    replaced: int = 0


class CampaignSummary(Model):
    id: str
    name: str
    location_label: str
    radius_mi: float
    industry: str
    status: CampaignStatus
    status_detail: str | None
    lead_target: int
    counts: LeadCounts
    eta_seconds: int | None
    created_at: str
    finished_at: str | None


class FailedItem(Model):
    lead_id: str
    name: str
    reason: str


class ReplacedItem(Model):
    name: str
    reason: str


class FinishSummary(Model):
    found: int
    ready: int
    needs_review: int
    failed: list[FailedItem]
    replaced: list[ReplacedItem]
    seconds: int


class QuestionAnswer(Model):
    text: str
    answer: Literal["yes", "no"]


class Campaign(CampaignSummary):
    input: CampaignInput
    restatement: str
    categories: list[PlanCategory]
    question_answer: QuestionAnswer | None
    notices: list[str]
    finish_summary: FinishSummary | None
    cost_usd: float


class LastInputResponse(Model):
    input: CampaignInput | None


class GeoSuggestItem(Model):
    label: str
    kind: Literal["zip", "city"]


class GeoSuggestResponse(Model):
    results: list[GeoSuggestItem]


class IndustriesResponse(Model):
    suggestions: list[str]


# ---------- leads ----------

class LeadSummary(Model):
    id: str
    campaign_id: str
    name: str
    category_label: str
    locality: str
    distance_mi: float
    status: LeadStatus
    stage_label: str | None
    step: int | None
    fit_score: int | None
    fit_label: FitLabel | None
    contact_kind: ContactKind | None
    email_subject: str | None
    has_warnings: bool
    created_at: str
    updated_at: str


class Contact(Model):
    kind: ContactKind
    email: str | None
    form_url: str | None
    source_kind: SourceKind | None
    source_url: str | None
    source_label: str | None
    seen_at: str | None
    note: str | None


class Fact(Model):
    id: str
    text: str
    quote: str
    source_kind: SourceKind
    url: str | None
    fragment_url: str | None
    source_label: str
    seen_at: str
    state: FactState
    quote_found: bool
    flagged_wrong: bool
    used: bool


class Hook(Model):
    id: str
    kind: str
    title: str
    reason: str
    fact_ids: list[str]


class Sentence(Model):
    id: str
    text: str
    kind: SentenceKind
    fact_ids: list[str]
    state: SentenceState
    edited: bool


class Email(Model):
    version_id: str
    subject: str
    greeting: str
    paragraphs: list[list[Sentence]]
    signoff: str
    footer: str
    word_count: int
    subject_word_count: int
    edited: bool
    origin: Literal["draft", "rewrite", "edit", "restore"]
    origin_detail: str | None
    created_at: str


class EmailVersionRef(Model):
    version_id: str
    origin: Literal["draft", "rewrite", "edit", "restore"]
    origin_detail: str | None
    created_at: str


class SiteCheck(Model):
    url: str
    checked_at: str
    secure: bool | None
    mobile_ready: bool | None
    load_seconds: float | None
    copyright_year: int | None
    online_booking: bool | None
    hours: bool | None
    prices: bool | None
    social: list[str]


class EditorCheck(Model):
    key: Literal["facts", "rules", "spam", "subject"]
    label: str
    passed: bool
    note: str | None


class EditorReport(Model):
    checks: list[EditorCheck]
    passed: int
    total: int
    fixes: list[str]
    notes: str | None


class ProvenancePage(Model):
    url: str
    label: str
    fetched_at: str


class Provenance(Model):
    model: str
    pages: list[ProvenancePage]
    drafted_at: str | None
    checks_passed: int
    checks_total: int


class ListingInfo(Model):
    dataset: str
    release: str
    updated_at: str | None


class Verification(Model):
    status: Literal["verified", "unverified", "failed"]
    note: str
    url: str | None


class LastAction(Model):
    action_id: str
    action: str
    created_at: str


class Lead(LeadSummary):
    address: str
    website: str | None
    phone: str | None
    listing: ListingInfo
    fit_reason: str | None
    verification: Verification | None
    contact: Contact | None
    facts: list[Fact]
    site_check: SiteCheck | None
    hook: Hook | None
    alternatives: list[Hook]
    email: Email | None
    previous_email: Email | None
    versions: list[EmailVersionRef]
    editor: EditorReport | None
    warnings: list[str]
    provenance: Provenance | None
    skip_reason: str | None
    approved_at: str | None
    sent_at: str | None
    replied_at: str | None
    reply_outcome: ReplyOutcome | None
    error: str | None
    can_retry: bool
    mailto_url: str | None
    copy_text: str | None
    last_action: LastAction | None
    cost_usd: float


class UpdateEmailRequest(Model):
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=6000)

    @field_validator("subject", mode="before")
    @classmethod
    def _subject(cls, v: Any) -> Any:
        return one_line(v)


class RewriteRequest(Model):
    mode: RewriteMode
    hook_id: str | None = None


class SkipRequest(Model):
    reason: str = Field(min_length=1, max_length=300)

    @field_validator("reason", mode="before")
    @classmethod
    def _reason(cls, v: Any) -> Any:
        return one_line(v)


class DncRequest(Model):
    reason: str | None = Field(default=None, max_length=300)


class RepliedRequest(Model):
    outcome: ReplyOutcome


class RetryRequest(Model):
    mode: Literal["retry", "without_site"] = "retry"


class WrongFactRequest(Model):
    note: str | None = Field(default=None, max_length=500)


class LeadEventRequest(Model):
    kind: Literal["copied", "copied_address", "opened_mailto"]


class ActionResult(Model):
    lead: Lead
    action_id: str
    sending: SendingToday


class UndoResult(Model):
    lead: Lead
    sending: SendingToday


# ---------- sent ----------

class SentItem(LeadSummary):
    campaign_name: str
    contact_email: str | None
    approved_at: str | None
    sent_at: str | None
    replied_at: str | None
    reply_outcome: ReplyOutcome | None


class SentResponse(Model):
    items: list[SentItem]
    sending: SendingToday


# ---------- do not contact ----------

class DncEntryOut(Model):
    id: str
    business_name: str | None
    domain: str | None
    email: str | None
    reason: str | None
    source: Literal["user", "lead", "reply"]
    created_at: str


class CreateDncRequest(Model):
    business_name: str | None = Field(default=None, max_length=300)
    domain: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=320)
    reason: str | None = Field(default=None, max_length=300)


# ---------- numbers ----------

class Funnel(Model):
    found: int = 0
    approved: int = 0
    sent: int = 0
    replied: int = 0


class Totals(Funnel):
    reply_rate: float | None


class WeekFunnel(Funnel):
    reply_rate: float | None = None
    """Of the emails sent that week, the share with a reply logged (at any time); null when none were sent."""


class WeeklyFunnel(Funnel):
    week_start: str


class CampaignFunnel(Funnel):
    campaign_id: str
    name: str
    created_at: str


class Stats(Model):
    totals: Totals
    this_week: WeekFunnel
    last_week: WeekFunnel
    weekly: list[WeeklyFunnel]
    by_campaign: list[CampaignFunnel]
    sending: SendingToday
    usage: Usage


# ---------- admin ----------

class AdminAi(Model):
    state: Literal["ok", "paused", "unconfigured"]
    reason: str | None
    since: str | None
    model: str
    web_search: Literal["available", "unavailable", "unknown"]


class SkillSpend(Model):
    skill: str
    requests: int
    cost: float
    avg_latency_ms: int


class DailySpend(Model):
    date: str
    cost: float
    requests: int


class AdminSpend(Model):
    today: float
    d7: float
    d30: float
    per_lead_avg: float | None
    requests_today: int
    by_skill: list[SkillSpend]
    daily: list[DailySpend]


class AdminBalance(Model):
    amount: float | None
    as_of: str | None
    spent_since: float
    remaining: float | None
    avg_daily: float
    days_left: float | None


class AdminQueue(Model):
    queued: int
    running: int
    failed_24h: int


class AdminQuality(Model):
    audited_facts: int
    supported_pct: float | None
    leads_with_contact_pct: float | None
    avg_cost_per_lead: float | None


class AdminOverview(Model):
    ai: AdminAi
    spend: AdminSpend
    balance: AdminBalance
    queue: AdminQueue
    quality: AdminQuality


class SetBalanceRequest(Model):
    amount: float = Field(ge=0, le=1_000_000)


class ErrorEntry(Model):
    id: str
    created_at: str
    where: str
    message: str
    campaign_id: str | None
    lead_id: str | None


class AiCallRow(Model):
    id: str
    created_at: str
    skill: str
    thinking: bool
    prompt_tokens: int
    cached_tokens: int
    completion_tokens: int
    web_search_calls: int
    cost_usd: float
    latency_ms: int
    status: Literal["ok", "error"]
    error: str | None


class AuditFact(Model):
    fact: Fact
    verdict: Literal["supported", "not_supported"] | None


class AuditLead(Model):
    lead_id: str
    name: str
    campaign_name: str
    website: str | None
    email_subject: str | None
    facts: list[AuditFact]


class AuditVerdictRequest(Model):
    verdict: Literal["supported", "not_supported"]


class OptOutOut(Model):
    id: str
    domain: str
    contact_email: str | None
    note: str | None
    created_at: str


class CreateOptOutRequest(Model):
    domain: str = Field(min_length=3, max_length=300)
    contact_email: str | None = Field(default=None, max_length=320)
    note: str | None = Field(default=None, max_length=500)


# ---------- public ----------

class PublicOptOutRequest(Model):
    domain: str = Field(min_length=3, max_length=300)
    email: str = Field(min_length=3, max_length=320)
    note: str | None = Field(default=None, max_length=1000)


class OkResponse(Model):
    ok: Literal[True] = True
    message: str | None = None


class HealthResponse(Model):
    ok: bool
    version: str


class DevWorkspaceRequest(Model):
    """Test servers only: pick (or make) a separate workspace for a test."""
    key: str = Field(min_length=1, max_length=200)
    onboarded: bool = True
    name: str | None = Field(default=None, max_length=120)
