// NearbyNudge 2.0 API contract: the single source of truth for request and
// response shapes. The AI is Claude Sonnet 5.5 through the Anthropic API (the product's
// one outside API). Show its name from SystemStatus.ai_name; never hard-code a vendor name.
//
// response shapes. The backend's pydantic schemas mirror these names exactly.
// The frontend copies this file verbatim to src/lib/api/types.ts.
//
// Conventions
// - All timestamps are ISO 8601 strings in UTC ("2026-10-24T18:03:11Z").
// - IDs are opaque strings.
// - Money is US dollars as a number (0.0123).
// - Errors: non-2xx responses carry ApiErrorBody.

export interface ApiErrorBody {
  error: {
    code: string; // machine code, e.g. "not_found", "validation", "daily_cap_reached"
    message: string; // plain-language sentence safe to show users
    fields?: Record<string, string>; // per-field messages for form errors
  };
}

// ---------- shared enums ----------

export type Tone = "professional" | "friendly" | "direct";

export type LeadStatus =
  | "queued" // waiting for a research slot
  | "reading" // step 1 of 4: the reader is visiting the business's own site
  | "choosing" // step 2 of 4: the AI picks the hook and scores fit
  | "writing" // step 3 of 4: the AI writes the email
  | "checking" // step 4 of 4: the AI editor checks facts and rules
  | "ready" // draft waiting for review
  | "needs_review" // an editor check failed or a fact needs checking
  | "approved"
  | "sent" // the user marked it sent
  | "replied" // the user logged a reply
  | "skipped"
  | "dnc" // do not contact
  | "failed"; // "Couldn't finish" (site unreadable, AI cost limit, AI error)

export type CampaignStatus = "finding" | "researching" | "done" | "paused" | "failed";
export type FitLabel = "Strong" | "Good" | "Weak"; // Strong >= 80, Good 60-79, Weak < 60
export type ContactKind = "email" | "form" | "none";
export type SourceKind = "site" | "listing" | "search";
export type SentenceKind = "claim" | "offer" | "other"; // claim = about the business; offer = about the sender's offer/proof; other = greeting, ask, pleasantry
export type SentenceState = "supported" | "check" | "no_source" | "none"; // none = sentence kind offer/other, needs no source
export type FactState = "supported" | "check";
export type RewriteMode = "shorter" | "friendlier" | "more_direct" | "another_hook";
export type ReplyOutcome = "interested" | "no_thanks" | "other";

// ---------- sign-in (one account; no sign-up) ----------

// GET /api/auth/session, POST /api/auth/login. `enabled`: this copy asks for sign-in;
// when it doesn't, `signed_in` is always true and there is nothing to sign out of.
export interface SessionInfo {
  enabled: boolean;
  signed_in: boolean;
  email: string | null; // the account's email, once signed in
}

export interface LoginRequest {
  email: string;
  password: string;
}

// ---------- account (one built-in workspace, no sign-in) ----------

// There are no accounts: everyone who opens the app uses the same workspace.
export interface User {
  id: string;
  name: string; // the sender profile's sender_name ("" before onboarding)
  onboarded: boolean; // sender profile complete (postal address required)
  created_at: string;
}

// GET /api/me: always a user, never 401.
export interface MeResponse {
  user: User;
}

export interface SenderProfile {
  sender_name: string; // "Maya Chen"
  sender_title: string; // may be ""
  sender_company: string; // "Brightline Ads"
  sender_address: string; // postal address, required (CAN-SPAM)
  default_tone: Tone;
  timezone: string; // IANA, e.g. "America/New_York"; the daily send cap resets at local midnight
}

export interface Preferences {
  shortcuts_enabled: boolean; // single-key shortcuts (WCAG 2.1.4)
  webmail_mode: boolean; // Copy becomes the main send button
  theme: "system" | "light" | "dark";
  compact_rows: boolean; // 32 px rows instead of 40 px
  live_updates: boolean; // false = paused (WCAG 2.2.2)
}

export interface Usage {
  used: number; // leads drafted this calendar month (failed and replaced leads don't count)
  limit: number; // 100 in the beta
  month_label: string; // "October 2026"
}

export interface SendingToday {
  sent_today: number;
  daily_cap: number; // 20
  resets_at: string; // next local midnight, as UTC ISO
}

export interface Account {
  user: User;
  profile: SenderProfile | null;
  preferences: Preferences;
  usage: Usage;
  sending: SendingToday;
  footer_preview: string | null; // the locked email footer built from the profile
}

// DELETE /api/account deletes all data (campaigns, leads, do-not-contact list,
// sender profile, preferences); the workspace starts over at onboarding.
export interface DeleteAccountRequest {
  confirm: string; // must be "delete" (trimmed, any case)
}

// ---------- system status ----------

export interface SystemStatus {
  ai_state: "ok" | "paused" | "unconfigured";
  ai_name: string; // display name of the AI, e.g. "Claude" -> "Claude's plan", "Claude's judgment"
  ai_model: string; // e.g. "claude-sonnet-5-5"
  // Calm, user-facing copy when not ok, e.g.
  // "Research paused. We'll resume automatically, and nothing is lost."
  message: string | null;
}

// ---------- campaigns ----------

export interface CampaignInput {
  location: string; // address, ZIP or "City, ST"
  radius_mi: number; // 1-25, default 5
  industry: string; // free text, e.g. "Dentists"
  offer_what: string; // what you sell, e.g. "Google Ads for dental practices"
  offer_proof: string; // a proof point, may be ""
  offer_cta: string; // the ask, e.g. "Free 15-minute audit"
  tone: Tone;
  lead_target: number; // 5-25, default 10
}

export interface PlanCategory {
  key: string; // Overture taxonomy key, e.g. "general_dentistry"
  label: string; // "General dentistry"
  count: number | null; // listings within the radius; null if the area isn't loaded yet
}

export interface CampaignPlan {
  plan_id: string; // valid for 1 hour; pass to POST /api/campaigns
  location: {
    label: string; // "Arlington, VA"
    kind: "zip" | "city";
    lat: number;
    lon: number;
    note: string | null; // "Searching from the center of Arlington, VA"
  };
  restatement: string; // the AI's one- or two-sentence plan
  categories: PlanCategory[]; // included
  question: { text: string; categories: PlanCategory[] } | null; // at most one; "yes" adds these categories
  candidate_count: number | null; // matches after filters; null while the area loads
  coverage: "ready" | "loading_needed"; // loading_needed: first search here takes about a minute longer
  warnings: string[]; // e.g. "Only 6 businesses match. Try a 10-mile radius or a broader industry."
}

export interface CreateCampaignRequest {
  plan_id: string;
  input: CampaignInput;
  answer: "yes" | "no" | null; // answer to plan.question; null when there was no question
}

export interface LeadCounts {
  total: number; // visible leads (excludes replaced)
  in_progress: number; // queued + reading + choosing + writing + checking
  ready: number;
  needs_review: number;
  approved: number;
  sent: number; // includes replied
  replied: number;
  skipped: number;
  dnc: number;
  failed: number;
  replaced: number; // hidden leads replaced by the next in line
}

export interface CampaignSummary {
  id: string;
  name: string; // "Dentists within 5 mi of Arlington, VA"
  location_label: string;
  radius_mi: number;
  industry: string;
  status: CampaignStatus;
  status_detail: string | null; // "Finding businesses near Arlington, VA…", "Loading business listings for this area (first time only)"
  lead_target: number;
  counts: LeadCounts;
  eta_seconds: number | null; // remaining time estimate while running
  created_at: string;
  finished_at: string | null;
}

export interface FinishSummary {
  found: number;
  ready: number;
  needs_review: number;
  failed: { lead_id: string; name: string; reason: string }[];
  replaced: { name: string; reason: string }[];
  seconds: number;
}

export interface Campaign extends CampaignSummary {
  input: CampaignInput;
  restatement: string;
  categories: PlanCategory[];
  question_answer: { text: string; answer: "yes" | "no" } | null;
  notices: string[]; // "Replaced 2 businesses that looked closed", "We found 6 of 10. Try a 10-mile radius or a broader industry."
  finish_summary: FinishSummary | null;
  cost_usd: number;
}

export interface LastInputResponse {
  input: CampaignInput | null; // pre-fill from the user's last campaign
}
export interface GeoSuggestResponse {
  results: { label: string; kind: "zip" | "city" }[];
}
export interface IndustriesResponse {
  suggestions: string[]; // 1.0's 12 suggestions
}

// ---------- leads ----------

export interface LeadSummary {
  id: string;
  campaign_id: string;
  name: string;
  category_label: string; // "Dentist"
  locality: string; // "Arlington, VA"
  distance_mi: number; // one decimal
  status: LeadStatus;
  stage_label: string | null; // "Reading site", "Choosing hook", "Writing", "Checking", "Queued"
  step: number | null; // 1-4 while in progress, else null
  fit_score: number | null; // 0-100
  fit_label: FitLabel | null;
  contact_kind: ContactKind | null; // null until research finishes
  email_subject: string | null;
  has_warnings: boolean; // any Check / No source sentence or failed editor check
  created_at: string;
  updated_at: string;
}

export interface Contact {
  kind: ContactKind;
  email: string | null;
  form_url: string | null;
  source_kind: SourceKind | null;
  source_url: string | null;
  source_label: string | null; // "Contact page", "Business listing (Overture Maps, Oct 2026)"
  seen_at: string | null;
  note: string | null; // e.g. "Skipped a form that says no solicitations"
}

export interface Fact {
  id: string;
  text: string; // the fact, in the AI's words, <= 25 words
  quote: string; // exact supporting quote from the page, <= 25 words
  source_kind: SourceKind;
  url: string | null; // the page it came from (site/search); null for listing facts
  fragment_url: string | null; // url#:~:text=... jumping to the quote
  source_label: string; // "About page", "Home page", "Business listing (Overture Maps, Oct 2026)"
  seen_at: string;
  state: FactState; // supported only when the editor confirmed the quote backs the claim
  quote_found: boolean; // our code found the quote in the saved page
  flagged_wrong: boolean;
  used: boolean; // cited by the current email
}

export interface Hook {
  id: string; // "h1", "h2", "h3"
  kind: string; // "no_online_booking" | "site_gap" | "missing_hours" | "missing_prices" | "no_website" | "good_news" | "seasonal" | "other"
  title: string; // "No online booking"
  reason: string; // one sentence tying it to the offer
  fact_ids: string[]; // evidence; the chosen hook cites at least one fact
}

export interface Sentence {
  id: string;
  text: string;
  kind: SentenceKind;
  fact_ids: string[];
  state: SentenceState;
  edited: boolean; // changed by the user since the last AI check
}

export interface Email {
  version_id: string;
  subject: string;
  greeting: string; // "Hi Dr. Lee,"
  paragraphs: Sentence[][];
  signoff: string; // "Best,"
  footer: string; // locked WR2 footer, multi-line, built from the sender profile
  word_count: number; // greeting + body + signoff, excluding footer
  subject_word_count: number;
  edited: boolean;
  origin: "draft" | "rewrite" | "edit" | "restore";
  origin_detail: string | null; // "shorter", "another_hook: Missing hours", "removed a wrong fact"
  created_at: string;
}

export interface EmailVersionRef {
  version_id: string;
  origin: Email["origin"];
  origin_detail: string | null;
  created_at: string;
}

export interface SiteCheck {
  url: string;
  checked_at: string;
  secure: boolean | null; // https
  mobile_ready: boolean | null; // viewport meta
  load_seconds: number | null;
  copyright_year: number | null;
  online_booking: boolean | null;
  hours: boolean | null;
  prices: boolean | null;
  social: string[]; // ["Facebook", "Instagram"]
}

export interface EditorCheck {
  key: "facts" | "rules" | "spam" | "subject";
  label: string; // "Facts match evidence", "Writing rules", "No placeholders or spam", "Honest subject"
  passed: boolean;
  note: string | null;
}

export interface EditorReport {
  checks: EditorCheck[];
  passed: number;
  total: number;
  fixes: string[]; // "Shortened the subject from 12 to 8 words"
  notes: string | null; // what to check, when needs_review
}

export interface Provenance {
  model: string; // "claude-sonnet-5-5"
  pages: { url: string; label: string; fetched_at: string }[];
  drafted_at: string | null;
  checks_passed: number;
  checks_total: number;
}

export interface Lead extends LeadSummary {
  address: string;
  website: string | null;
  phone: string | null;
  listing: { dataset: string; release: string; updated_at: string | null }; // "Overture Maps Places", "2026-10-21.0"
  fit_reason: string | null; // AI judgment, one line
  verification: { status: "verified" | "unverified" | "failed"; note: string; url: string | null } | null;
  contact: Contact | null;
  facts: Fact[];
  site_check: SiteCheck | null;
  hook: Hook | null;
  alternatives: Hook[]; // two alternatives
  email: Email | null;
  previous_email: Email | null; // set right after a rewrite, for "Show changes"
  versions: EmailVersionRef[]; // newest first, at most 5
  editor: EditorReport | null;
  warnings: string[]; // shown in place when approving, e.g. "1 sentence needs checking"
  provenance: Provenance | null;
  skip_reason: string | null;
  approved_at: string | null;
  sent_at: string | null;
  replied_at: string | null;
  reply_outcome: ReplyOutcome | null;
  error: string | null; // "Couldn't finish" reason
  can_retry: boolean;
  mailto_url: string | null; // mailto:addr?subject=…&body=… (no fact markers), null without an email contact
  copy_text: string | null; // "Subject: …\n\n<body>\n\n<footer>" (no fact markers)
  last_action: { action_id: string; action: string; created_at: string } | null; // newest undoable action
  cost_usd: number;
}

export interface UpdateEmailRequest {
  subject: string;
  body: string; // greeting line, blank line, paragraphs separated by blank lines, blank line, signoff line
}
export interface RewriteRequest {
  mode: RewriteMode;
  hook_id?: string; // for another_hook: which alternative; default the first alternative
}
export interface SkipRequest {
  reason: string; // "Already a client" | "Not a fit" | "Wrong place" | free text
}
export interface DncRequest {
  reason?: string;
}
export interface RepliedRequest {
  outcome: ReplyOutcome; // no_thanks also adds the business to do-not-contact
}
export interface RetryRequest {
  mode: "retry" | "without_site";
}
export interface WrongFactRequest {
  note?: string;
}
export interface LeadEventRequest {
  kind: "copied" | "copied_address" | "opened_mailto";
}

export interface ActionResult {
  lead: Lead;
  action_id: string; // pass to POST /api/actions/{action_id}/undo
  sending: SendingToday;
}
export interface UndoResult {
  lead: Lead;
  sending: SendingToday;
}

// ---------- sent ----------

export interface SentItem extends LeadSummary {
  campaign_name: string;
  contact_email: string | null;
  approved_at: string | null;
  sent_at: string | null;
  replied_at: string | null;
  reply_outcome: ReplyOutcome | null;
}
export interface SentResponse {
  items: SentItem[];
  sending: SendingToday;
}

// ---------- do not contact ----------

export interface DncEntry {
  id: string;
  business_name: string | null;
  domain: string | null;
  email: string | null;
  reason: string | null;
  source: "user" | "lead" | "reply";
  created_at: string;
}
export interface CreateDncRequest {
  business_name?: string;
  domain?: string;
  email?: string;
  reason?: string;
}

// ---------- numbers ----------

export interface Funnel {
  found: number; // leads drafted (ready or later)
  approved: number; // approved, sent or replied
  sent: number; // sent or replied
  replied: number;
}
export interface Stats {
  totals: Funnel & { reply_rate: number | null }; // replied / sent
  // reply_rate: of the emails sent that week, the share with a reply logged (at any time); null with no sends
  this_week: Funnel & { reply_rate?: number | null };
  last_week: Funnel & { reply_rate?: number | null };
  weekly: (Funnel & { week_start: string })[]; // last 8 weeks, oldest first, Monday dates "2026-10-19"
  by_campaign: (Funnel & { campaign_id: string; name: string; created_at: string })[];
  sending: SendingToday;
  usage: Usage;
}

// ---------- admin console (open to everyone; there is no admin role) ----------

export interface AdminOverview {
  ai: {
    state: "ok" | "paused" | "unconfigured";
    reason: string | null; // "balance" | "auth" | "config" | "rate_limited" | "down" | "unconfigured" | null
    since: string | null;
    model: string;
    web_search: "available" | "unavailable" | "unknown";
  };
  spend: {
    today: number;
    d7: number;
    d30: number;
    per_lead_avg: number | null;
    requests_today: number;
    by_skill: { skill: string; requests: number; cost: number; avg_latency_ms: number }[];
    daily: { date: string; cost: number; requests: number }[]; // last 30 days, oldest first
  };
  balance: {
    amount: number | null; // last balance the admin entered
    as_of: string | null;
    spent_since: number;
    remaining: number | null;
    avg_daily: number; // last 7 days
    days_left: number | null;
  };
  queue: { queued: number; running: number; failed_24h: number };
  quality: {
    audited_facts: number;
    supported_pct: number | null; // target >= 98
    leads_with_contact_pct: number | null; // target >= 60
    avg_cost_per_lead: number | null; // target <= 0.05
  };
}
export interface SetBalanceRequest {
  amount: number;
}
export interface ErrorEntry {
  id: string;
  created_at: string;
  where: string; // "ai", "reader", "pipeline", "api"
  message: string;
  campaign_id: string | null;
  lead_id: string | null;
}
export interface AiCallRow {
  id: string;
  created_at: string;
  skill: string;
  thinking: boolean;
  prompt_tokens: number;
  cached_tokens: number;
  completion_tokens: number;
  web_search_calls: number;
  cost_usd: number;
  latency_ms: number;
  status: "ok" | "error";
  error: string | null;
}
export interface AuditFact {
  fact: Fact;
  verdict: "supported" | "not_supported" | null;
}
export interface AuditLead {
  lead_id: string;
  name: string;
  campaign_name: string;
  website: string | null;
  email_subject: string | null;
  facts: AuditFact[];
}
export interface AuditVerdictRequest {
  verdict: "supported" | "not_supported";
}
export interface OptOut {
  id: string;
  domain: string;
  contact_email: string | null;
  note: string | null;
  created_at: string;
}
export interface CreateOptOutRequest {
  domain: string;
  contact_email?: string;
  note?: string;
}

// ---------- public ----------

export interface PublicOptOutRequest {
  domain: string; // the site owner's domain, e.g. "samplestudio.example"
  email: string; // contact for confirmation
  note?: string;
}
export interface OkResponse {
  ok: true;
  message?: string;
}

// ---------- live events (Server-Sent Events) ----------
// GET /api/campaigns/{id}/events  (text/event-stream)
//   event: lead      data: LeadSummary (plus `replaced: true` when the lead was replaced: drop it from the list)
//   event: campaign  data: CampaignSummary
//   event: ping      data: {}            (every 15 s)

// ---------- browser tests only ----------
// POST /api/dev/workspace -> MeResponse. Exists only on the test server
// (backend/scripts/e2e_server.py), never in the real app. It gets or creates an
// isolated workspace for `key` and sets the nn_dev_workspace cookie; later
// requests with that cookie use it, requests without it use the default workspace.
export interface DevWorkspaceRequest {
  key: string; // same key -> same workspace
  onboarded?: boolean; // default true: with the test sender profile; false: no profile yet
  name?: string; // sender_name for the test profile (default "Test Sender")
}
