// In-memory state and the live simulation for the mock adapter (dev only).
import type { CampaignStreamHandlers } from "../api"
import type {
  Campaign,
  CampaignInput,
  CampaignSummary,
  Contact,
  DncEntry,
  EditorReport,
  Email,
  EmailVersionRef,
  Fact,
  FinishSummary,
  Hook,
  Lead,
  LeadCounts,
  LeadStatus,
  LeadSummary,
  Preferences,
  Provenance,
  RewriteMode,
  SenderProfile,
  SendingToday,
  Sentence,
  SiteCheck,
  User,
} from "../types"
import { composeBody, countWords, parseBody } from "@/lib/email"
import * as C from "./content"
import {
  ago,
  buildMailto,
  clone,
  DAY,
  domainOf,
  fragmentUrl,
  HOUR,
  MINUTE,
  mockSetting,
  nextLocalMidnight,
  nowIso,
  uid,
} from "./util"

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface LeadRecord {
  lead: Lead
  profile: C.Profile
  offer: C.OfferSpec
  hidden: boolean
  stageEndsAt: number | null
  replaceReason?: string
  failReason?: string
  withoutSite?: boolean
  hookIndex: number
  versions: Email[] // newest first, at most 5
  actions: string[] // undoable action ids, newest last
}

export interface CampaignRecord {
  campaign: Campaign
  offer: C.OfferSpec
  kind: C.IndustryKind
  findingUntil: number | null
  pending: { profile: C.Profile; replaceReason?: string; failReason?: string }[]
  reserve: C.Profile[]
  replaced: { name: string; reason: string }[]
  startedAt: number
}

export interface ActionRecord {
  id: string
  leadId: string
  action: "approve" | "skip" | "dnc" | "sent" | "replied"
  before: Pick<
    Lead,
    "status" | "approved_at" | "sent_at" | "replied_at" | "reply_outcome" | "skip_reason"
  >
  dncEntryId: string | null
  createdAt: string
}

const ACTIVE: LeadStatus[] = ["reading", "choosing", "writing", "checking"]
const IN_PROGRESS: LeadStatus[] = ["queued", ...ACTIVE]
const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  reading: "Reading site",
  choosing: "Choosing hook",
  writing: "Writing",
  checking: "Checking",
}
const STEP: Record<string, number | null> = {
  queued: null,
  reading: 1,
  choosing: 2,
  writing: 3,
  checking: 4,
}
const AI_MODEL = "claude-sonnet-5-5"

export function speed() {
  return mockSetting("nn-mock-speed", 1)
}
function stageMs() {
  const s = speed()
  return s <= 0 ? Number.POSITIVE_INFINITY : 4200 / s
}

// ---------------------------------------------------------------------------
// Account state
// ---------------------------------------------------------------------------

const startNotOnboarded = mockSetting("nn-mock-onboarded", 1) === 0

const DEFAULT_PREFERENCES: Preferences = {
  shortcuts_enabled: true,
  webmail_mode: false,
  theme: "system",
  compact_rows: false,
  live_updates: true,
}

/** The one built-in workspace (there is no sign-in). */
export const db = {
  user: {
    id: "w1",
    name: startNotOnboarded ? "" : C.SENDER.name,
    onboarded: !startNotOnboarded,
    created_at: ago(30 * DAY),
  } as User,
  profile: (startNotOnboarded
    ? null
    : {
        sender_name: C.SENDER.name,
        sender_title: C.SENDER.title,
        sender_company: C.SENDER.company,
        sender_address: C.SENDER.address,
        default_tone: "professional",
        timezone: "America/New_York",
      }) as SenderProfile | null,
  preferences: { ...DEFAULT_PREFERENCES },
  usageUsed: 34,
  sentToday: Math.max(0, Math.min(20, mockSetting("nn-mock-sent-today", 7))),
  dailyCap: 20,
  campaigns: new Map<string, CampaignRecord>(),
  campaignOrder: [] as string[], // newest first
  leads: new Map<string, LeadRecord>(),
  actions: new Map<string, ActionRecord>(),
  dnc: [] as DncEntry[],
  plans: new Map<string, { input: CampaignInput; createdAt: number }>(),
  events: [] as { leadId: string; kind: string; at: string }[],
}

/**
 * Delete all data (DELETE /api/account): campaigns, leads, actions, the
 * do-not-contact list, the sender profile and preferences. The workspace
 * starts over at the sender profile set-up.
 */
export function resetWorkspace() {
  db.campaigns.clear()
  db.campaignOrder = []
  db.leads.clear()
  db.actions.clear()
  db.dnc = []
  db.plans.clear()
  db.events = []
  db.profile = null
  db.preferences = { ...DEFAULT_PREFERENCES }
  db.usageUsed = 0
  db.sentToday = 0
  db.user = { ...db.user, name: "", onboarded: false }
}

export function footerText(): string {
  const p = db.profile
  if (!p) return C.FOOTER
  return [
    p.sender_name,
    p.sender_title ? `${p.sender_title}, ${p.sender_company}` : p.sender_company,
    p.sender_address,
    `This email is a business offer from ${p.sender_company}.`,
    `Not interested? Reply "no thanks" and I won't email again.`,
  ].join("\n")
}

export function sendingToday(): SendingToday {
  return { sent_today: db.sentToday, daily_cap: db.dailyCap, resets_at: nextLocalMidnight() }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function fitLabel(score: number | null) {
  if (score === null) return null
  return score >= 80 ? "Strong" : score >= 60 ? "Good" : "Weak"
}

const siteUrl = (profile: C.Profile) => (profile.domain ? `https://${profile.domain}` : null)
const pageUrl = (profile: C.Profile, path: string) => {
  const site = siteUrl(profile)
  return site ? `${site}${path === "/" ? "/" : path}` : null
}

function makeFacts(leadId: string, profile: C.Profile, seenAt: string, withoutSite = false): Fact[] {
  return profile.facts
    .filter((spec) => !withoutSite || spec.listing)
    .map((spec) => {
      const url = spec.listing ? null : pageUrl(profile, spec.path)
      return {
        id: `${leadId}-${spec.key}`,
        text: spec.text,
        quote: spec.quote,
        source_kind: spec.listing ? "listing" : "site",
        url,
        fragment_url: url ? fragmentUrl(url, spec.quote) : null,
        source_label: spec.page,
        seen_at: seenAt,
        state: spec.state ?? "supported",
        quote_found: !spec.listing,
        flagged_wrong: false,
        used: false,
      } satisfies Fact
    })
}

function makeContact(profile: C.Profile, seenAt: string): Contact {
  const c = profile.contact
  if (c.kind === "email") {
    return {
      kind: "email",
      email: c.email ?? null,
      form_url: null,
      source_kind: c.listing ? "listing" : "site",
      source_url: c.listing ? null : pageUrl(profile, "/contact"),
      source_label: c.label,
      seen_at: seenAt,
      note: c.note ?? null,
    }
  }
  if (c.kind === "form") {
    return {
      kind: "form",
      email: null,
      form_url: pageUrl(profile, c.formPath ?? "/contact"),
      source_kind: "site",
      source_url: pageUrl(profile, c.formPath ?? "/contact"),
      source_label: c.label,
      seen_at: seenAt,
      note: c.note ?? null,
    }
  }
  return {
    kind: "none",
    email: null,
    form_url: null,
    source_kind: null,
    source_url: null,
    source_label: null,
    seen_at: seenAt,
    note: c.note ?? null,
  }
}

function makeSiteCheck(profile: C.Profile, at: string): SiteCheck | null {
  const site = siteUrl(profile)
  if (!site) return null
  return {
    url: site,
    checked_at: at,
    secure: profile.site.secure,
    mobile_ready: profile.site.mobile,
    load_seconds: profile.site.load,
    copyright_year: profile.site.year,
    online_booking: profile.site.booking,
    hours: profile.site.hours,
    prices: profile.site.prices,
    social: profile.site.social,
  }
}

function hookObject(leadId: string, profile: C.Profile, index: number): Hook {
  const spec = profile.hooks[index]
  return {
    id: `h${index + 1}`,
    kind: spec.kind,
    title: spec.title,
    reason: spec.reason,
    fact_ids: spec.facts.map((key) => `${leadId}-${key}`),
  }
}

function sentence(
  leadId: string,
  text: string,
  kind: Sentence["kind"],
  factIds: string[],
  state: Sentence["state"],
  edited = false
): Sentence {
  return { id: `${leadId}-${uid("s")}`, text, kind, fact_ids: factIds, state, edited }
}

function claimSentences(leadId: string, profile: C.Profile, hookIndex: number, facts: Fact[]) {
  const known = new Set(facts.map((fact) => fact.id))
  return profile.hooks[hookIndex].claims.map((claim) => {
    const ids = claim.facts.map((key) => `${leadId}-${key}`).filter((id) => known.has(id))
    if (claim.state === "no_source") return sentence(leadId, claim.text, "claim", [], "no_source")
    // A claim whose evidence is missing is shown honestly as "No source".
    if (claim.facts.length > 0 && ids.length === 0) return sentence(leadId, claim.text, "claim", [], "no_source")
    if (ids.length === 0) return sentence(leadId, claim.text, "other", [], "none")
    return sentence(leadId, claim.text, "claim", ids, claim.state ?? "supported")
  })
}

function makeEmail(rec: LeadRecord, origin: Email["origin"] = "draft", detail: string | null = null): Email {
  const { lead, profile, offer } = rec
  const claims = claimSentences(lead.id, profile, rec.hookIndex, lead.facts)
  const email: Email = {
    version_id: uid("v"),
    subject: profile.hooks[rec.hookIndex].subject,
    greeting: profile.greeting,
    paragraphs: [
      claims,
      offer.offer.map((text) => sentence(lead.id, text, "offer", [], "none")),
      offer.cta.map((text) => sentence(lead.id, text, "other", [], "none")),
    ],
    signoff: "Best,",
    footer: footerText(),
    word_count: 0,
    subject_word_count: 0,
    edited: false,
    origin,
    origin_detail: detail,
    created_at: nowIso(),
  }
  return finalizeEmail(email)
}

function finalizeEmail(email: Email): Email {
  email.word_count = countWords(composeBody(email))
  email.subject_word_count = countWords(email.subject)
  email.footer = footerText()
  return email
}

function editorFor(rec: LeadRecord, email: Email | null): EditorReport {
  const problems = (email?.paragraphs ?? []).flat().filter((s) => s.state === "check" || s.state === "no_source")
  const spec = rec.profile.editor
  const factsPassed = problems.length === 0
  const checks: EditorReport["checks"] = [
    {
      key: "facts",
      label: "Facts match evidence",
      passed: factsPassed,
      note: factsPassed ? null : (spec?.failNote ?? `${problems.length} sentence needs checking.`),
    },
    { key: "rules", label: "Writing rules", passed: true, note: null },
    { key: "spam", label: "No placeholders or spam", passed: true, note: null },
    { key: "subject", label: "Honest subject", passed: true, note: null },
  ]
  const passed = checks.filter((check) => check.passed).length
  return {
    checks,
    passed,
    total: checks.length,
    fixes: spec?.fixes ?? [],
    notes: factsPassed ? null : (spec?.notes ?? "A sentence needs a source. Edit it or choose another hook."),
  }
}

function provenanceFor(rec: LeadRecord, at: string): Provenance {
  const pages = rec.withoutSite
    ? []
    : rec.profile.pages
        .map((page) => ({ url: pageUrl(rec.profile, page.path) ?? "", label: page.label, fetched_at: at }))
        .filter((page) => page.url)
  const editor = rec.lead.editor
  return {
    model: AI_MODEL,
    pages,
    drafted_at: rec.lead.email?.created_at ?? at,
    checks_passed: editor?.passed ?? 0,
    checks_total: editor?.total ?? 4,
  }
}

function warningsFor(lead: Lead): string[] {
  const sentences = (lead.email?.paragraphs ?? []).flat()
  const check = sentences.filter((s) => s.state === "check").length
  const none = sentences.filter((s) => s.state === "no_source").length
  const warnings: string[] = []
  if (check > 0) warnings.push(`${check} ${check === 1 ? "sentence needs" : "sentences need"} checking against the source.`)
  if (none > 0) warnings.push(`${none} ${none === 1 ? "sentence has" : "sentences have"} no source.`)
  if (lead.contact?.kind === "none") warnings.push("No published contact. You'll need another way to reach them.")
  return warnings
}

/** Recomputes everything derived from the lead's email and facts. */
function refreshDerived(rec: LeadRecord) {
  const lead = rec.lead
  const email = lead.email
  if (email) finalizeEmail(email)
  const cited = new Set((email?.paragraphs ?? []).flat().flatMap((s) => s.fact_ids))
  lead.facts = lead.facts.map((fact) => ({ ...fact, used: cited.has(fact.id) && !fact.flagged_wrong }))
  lead.email_subject = email?.subject ?? null
  if (email && lead.contact) {
    const body = composeBody(email)
    lead.copy_text = `Subject: ${email.subject}\n\n${body}\n\n${email.footer}`
    lead.mailto_url =
      lead.contact.kind === "email" && lead.contact.email
        ? buildMailto(lead.contact.email, email.subject, `${body}\n\n${email.footer}`)
        : null
  } else {
    lead.copy_text = null
    lead.mailto_url = null
  }
  lead.warnings = email ? warningsFor(lead) : []
  const editorFailed = lead.editor ? lead.editor.passed < lead.editor.total : false
  lead.has_warnings =
    (email?.paragraphs ?? []).flat().some((s) => s.state === "check" || s.state === "no_source") || editorFailed
  lead.versions = rec.versions.slice(0, 5).map(
    (v): EmailVersionRef => ({
      version_id: v.version_id,
      origin: v.origin,
      origin_detail: v.origin_detail,
      created_at: v.created_at,
    })
  )
  if (lead.provenance && lead.editor) {
    lead.provenance.checks_passed = lead.editor.passed
    lead.provenance.checks_total = lead.editor.total
  }
}

function pushVersion(rec: LeadRecord, email: Email) {
  rec.versions = [clone(email), ...rec.versions.filter((v) => v.version_id !== email.version_id)].slice(0, 5)
}

/** A fresh lead (as the listings know it, before research). */
function newLead(campaignId: string, profile: C.Profile, createdAt: string): Lead {
  const id = uid("l")
  return {
    id,
    campaign_id: campaignId,
    name: profile.name,
    category_label: profile.category,
    locality: profile.locality,
    distance_mi: profile.distance,
    status: "queued",
    stage_label: STAGE_LABEL.queued,
    step: null,
    fit_score: null,
    fit_label: null,
    contact_kind: null,
    email_subject: null,
    has_warnings: false,
    created_at: createdAt,
    updated_at: createdAt,
    address: profile.address,
    website: siteUrl(profile),
    phone: profile.phone,
    listing: { dataset: "Overture Maps Places", release: "2026-10-21.0", updated_at: "2026-10-21T00:00:00Z" },
    fit_reason: null,
    verification: null,
    contact: null,
    facts: [],
    site_check: null,
    hook: null,
    alternatives: [],
    email: null,
    previous_email: null,
    versions: [],
    editor: null,
    warnings: [],
    provenance: null,
    skip_reason: null,
    approved_at: null,
    sent_at: null,
    replied_at: null,
    reply_outcome: null,
    error: null,
    can_retry: false,
    mailto_url: null,
    copy_text: null,
    last_action: null,
    cost_usd: 0,
  }
}

function setStage(rec: LeadRecord, status: LeadStatus) {
  const lead = rec.lead
  lead.status = status
  lead.stage_label = STAGE_LABEL[status] ?? null
  lead.step = STEP[status] ?? null
}

/** Fills research results up to (and including) the given stage. */
function fillThrough(rec: LeadRecord, stage: "reading" | "choosing" | "writing" | "checking" | "done") {
  const lead = rec.lead
  const at = nowIso()
  const order = ["reading", "choosing", "writing", "checking", "done"]
  const reached = (s: string) => order.indexOf(stage) >= order.indexOf(s)
  if (reached("choosing")) {
    // reading finished: facts, contact, site check, verification
    if (lead.facts.length === 0) lead.facts = makeFacts(lead.id, rec.profile, at, rec.withoutSite)
    lead.contact = makeContact(rec.profile, at)
    lead.contact_kind = lead.contact.kind
    lead.site_check = rec.withoutSite ? null : makeSiteCheck(rec.profile, at)
    lead.verification = rec.withoutSite
      ? { status: "unverified", note: "Reviewed without site facts; only the business listing was used.", url: null }
      : { status: "verified", note: "The business's own site shows it operating at this address.", url: pageUrl(rec.profile, "/contact") }
    lead.cost_usd = 0.012
  }
  if (reached("writing")) {
    // hook chosen and fit scored
    lead.fit_score = rec.withoutSite ? Math.min(rec.profile.fit, 62) : rec.profile.fit
    lead.fit_label = fitLabel(lead.fit_score)
    lead.fit_reason = rec.profile.fitReason
    lead.hook = hookObject(lead.id, rec.profile, rec.hookIndex)
    lead.alternatives = rec.profile.hooks.map((_, i) => i).filter((i) => i !== rec.hookIndex).map((i) => hookObject(lead.id, rec.profile, i))
    lead.cost_usd = 0.021
  }
  if (reached("checking")) {
    if (!lead.email) {
      lead.email = makeEmail(rec)
      pushVersion(rec, lead.email)
    }
    lead.cost_usd = 0.031
  }
  if (reached("done")) {
    lead.editor = editorFor(rec, lead.email)
    lead.provenance = provenanceFor(rec, at)
    lead.cost_usd = 0.038
  }
  refreshDerived(rec)
}

export function summaryOf(lead: Lead): LeadSummary {
  return {
    id: lead.id,
    campaign_id: lead.campaign_id,
    name: lead.name,
    category_label: lead.category_label,
    locality: lead.locality,
    distance_mi: lead.distance_mi,
    status: lead.status,
    stage_label: lead.stage_label,
    step: lead.step,
    fit_score: lead.fit_score,
    fit_label: lead.fit_label,
    contact_kind: lead.contact_kind,
    email_subject: lead.email_subject,
    has_warnings: lead.has_warnings,
    created_at: lead.created_at,
    updated_at: lead.updated_at,
  }
}

// ---------------------------------------------------------------------------
// Campaign bookkeeping
// ---------------------------------------------------------------------------

export function campaignLeads(campaignId: string, includeHidden = false): LeadRecord[] {
  const records: LeadRecord[] = []
  for (const rec of db.leads.values()) {
    if (rec.lead.campaign_id === campaignId && (includeHidden || !rec.hidden)) records.push(rec)
  }
  return records
}

function countsFor(campaignId: string): LeadCounts {
  const counts: LeadCounts = {
    total: 0,
    in_progress: 0,
    ready: 0,
    needs_review: 0,
    approved: 0,
    sent: 0,
    replied: 0,
    skipped: 0,
    dnc: 0,
    failed: 0,
    replaced: 0,
  }
  for (const rec of campaignLeads(campaignId, true)) {
    if (rec.hidden) {
      counts.replaced += 1
      continue
    }
    counts.total += 1
    const s = rec.lead.status
    if (IN_PROGRESS.includes(s)) counts.in_progress += 1
    else if (s === "ready") counts.ready += 1
    else if (s === "needs_review") counts.needs_review += 1
    else if (s === "approved") counts.approved += 1
    else if (s === "sent") counts.sent += 1
    else if (s === "replied") {
      counts.sent += 1
      counts.replied += 1
    } else if (s === "skipped") counts.skipped += 1
    else if (s === "dnc") counts.dnc += 1
    else if (s === "failed") counts.failed += 1
  }
  return counts
}

function etaFor(campaignId: string): number | null {
  const records = campaignLeads(campaignId)
  let units = 0
  for (const rec of records) {
    const s = rec.lead.status
    if (s === "queued") units += 4
    else if (ACTIVE.includes(s)) units += 4 - (STEP[s] ?? 1) + 0.5
  }
  if (units === 0) return null
  const ms = stageMs()
  if (!Number.isFinite(ms)) return null
  return Math.max(10, Math.round((units * ms) / 4 / 1000))
}

function refreshCampaign(crec: CampaignRecord) {
  const c = crec.campaign
  c.counts = countsFor(c.id)
  const running = c.status === "finding" || c.status === "researching"
  c.eta_seconds = running ? (c.status === "finding" ? 90 : etaFor(c.id)) : null
  const notices: string[] = []
  if (crec.replaced.length > 0) {
    notices.push(
      `Replaced ${crec.replaced.length} ${crec.replaced.length === 1 ? "business that looked" : "businesses that looked"} closed`
    )
  }
  if (c.status === "done" && c.counts.total < c.lead_target) {
    notices.push(
      `We found ${c.counts.total} of ${c.lead_target}. Try a ${Math.min(25, c.radius_mi * 2)}-mile radius or a broader industry.`
    )
  }
  c.notices = notices
}

export function campaignSummaryOf(crec: CampaignRecord): CampaignSummary {
  const c = crec.campaign
  return {
    id: c.id,
    name: c.name,
    location_label: c.location_label,
    radius_mi: c.radius_mi,
    industry: c.industry,
    status: c.status,
    status_detail: c.status_detail,
    lead_target: c.lead_target,
    counts: clone(c.counts),
    eta_seconds: c.eta_seconds,
    created_at: c.created_at,
    finished_at: c.finished_at,
  }
}

function finishCampaign(crec: CampaignRecord) {
  const c = crec.campaign
  c.status = "done"
  c.status_detail = null
  c.finished_at = nowIso()
  refreshCampaign(crec)
  const records = campaignLeads(c.id)
  const summary: FinishSummary = {
    found: c.counts.total,
    ready: c.counts.ready + c.counts.approved + c.counts.sent + c.counts.skipped + c.counts.dnc,
    needs_review: c.counts.needs_review,
    failed: records
      .filter((r) => r.lead.status === "failed")
      .map((r) => ({ lead_id: r.lead.id, name: r.lead.name, reason: r.lead.error ?? "Couldn't finish" })),
    replaced: clone(crec.replaced),
    seconds: Math.round((Date.now() - crec.startedAt) / 1000),
  }
  c.finish_summary = summary
  c.cost_usd = Number(records.reduce((sum, r) => sum + r.lead.cost_usd, 0).toFixed(4))
}

// ---------------------------------------------------------------------------
// Live events
// ---------------------------------------------------------------------------

const listeners = new Map<string, Set<CampaignStreamHandlers>>()

export function subscribe(campaignId: string, handlers: CampaignStreamHandlers) {
  let set = listeners.get(campaignId)
  if (!set) {
    set = new Set()
    listeners.set(campaignId, set)
  }
  set.add(handlers)
  setTimeout(() => handlers.onOpen?.({ reconnected: false }), 30)
  return () => {
    set?.delete(handlers)
  }
}

function emitLead(rec: LeadRecord) {
  const summary = summaryOf(rec.lead)
  for (const handlers of listeners.get(rec.lead.campaign_id) ?? []) {
    handlers.onLead?.(clone(summary))
  }
}

function emitCampaign(crec: CampaignRecord) {
  refreshCampaign(crec)
  const summary = campaignSummaryOf(crec)
  for (const handlers of listeners.get(crec.campaign.id) ?? []) {
    handlers.onCampaign?.(clone(summary))
  }
}

/** Marks a lead changed, notifies listeners and updates its campaign. */
export function touch(rec: LeadRecord) {
  rec.lead.updated_at = nowIso()
  refreshDerived(rec)
  emitLead(rec)
  const crec = db.campaigns.get(rec.lead.campaign_id)
  if (crec) emitCampaign(crec)
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function addLead(
  crec: CampaignRecord,
  profile: C.Profile,
  opts: { status?: LeadStatus; createdAgo?: number; replaceReason?: string; failReason?: string } = {}
): LeadRecord {
  const created = ago(opts.createdAgo ?? 0)
  const lead = newLead(crec.campaign.id, profile, created)
  const rec: LeadRecord = {
    lead,
    profile,
    offer: crec.offer,
    hidden: false,
    stageEndsAt: null,
    replaceReason: opts.replaceReason,
    failReason: opts.failReason,
    hookIndex: 0,
    versions: [],
    actions: [],
  }
  db.leads.set(lead.id, rec)
  return rec
}

function startStage(rec: LeadRecord, status: LeadStatus, remainingMs?: number) {
  setStage(rec, status)
  rec.stageEndsAt = Date.now() + (remainingMs ?? stageMs() * (0.8 + ((rec.lead.name.length % 5) / 10)))
}

function advance(rec: LeadRecord, crec: CampaignRecord) {
  const s = rec.lead.status
  if (s === "reading") {
    if (rec.replaceReason) {
      rec.hidden = true
      rec.stageEndsAt = null
      crec.replaced.push({ name: rec.lead.name, reason: rec.replaceReason })
      // Like the real backend: a final "lead" event marks the replaced lead
      // (status "failed" plus replaced: true, a field outside api-types.ts).
      const gone = { ...summaryOf(rec.lead), status: "failed" as const, updated_at: nowIso(), replaced: true }
      for (const handlers of listeners.get(rec.lead.campaign_id) ?? []) handlers.onLead?.(clone(gone))
      const next = crec.reserve.shift()
      if (next) {
        const added = addLead(crec, next)
        rec.lead.updated_at = nowIso()
        emitLead(added)
      }
      emitCampaign(crec)
      return
    }
    if (rec.failReason) {
      setStage(rec, "failed")
      rec.lead.error = rec.failReason
      rec.lead.can_retry = true
      rec.stageEndsAt = null
      rec.failReason = undefined
      touch(rec)
      return
    }
    fillThrough(rec, "choosing")
    startStage(rec, "choosing")
  } else if (s === "choosing") {
    fillThrough(rec, "writing")
    startStage(rec, "writing")
  } else if (s === "writing") {
    fillThrough(rec, "checking")
    startStage(rec, "checking")
  } else if (s === "checking") {
    fillThrough(rec, "done")
    rec.stageEndsAt = null
    setStage(rec, rec.lead.has_warnings ? "needs_review" : "ready")
    db.usageUsed = Math.min(100, db.usageUsed + 1)
  }
  touch(rec)
}

function tick() {
  if (speed() <= 0) return
  const now = Date.now()
  for (const crec of db.campaigns.values()) {
    const c = crec.campaign
    if (c.status === "finding") {
      if (crec.findingUntil !== null && now >= crec.findingUntil) {
        c.status = "researching"
        c.status_detail = null
        crec.findingUntil = null
        for (const item of crec.pending) {
          const rec = addLead(crec, item.profile, { replaceReason: item.replaceReason, failReason: item.failReason })
          emitLead(rec)
        }
        crec.pending = []
        emitCampaign(crec)
      }
      continue
    }
    if (c.status !== "researching") continue
    const records = campaignLeads(c.id)
    for (const rec of records) {
      if (ACTIVE.includes(rec.lead.status) && rec.stageEndsAt !== null && now >= rec.stageEndsAt) {
        advance(rec, crec)
      }
    }
    const fresh = campaignLeads(c.id)
    let active = fresh.filter((r) => ACTIVE.includes(r.lead.status)).length
    for (const rec of fresh) {
      if (active >= 4) break
      if (rec.lead.status === "queued") {
        if (rec.withoutSite) {
          fillThrough(rec, "choosing")
          startStage(rec, "writing")
        } else {
          startStage(rec, "reading")
        }
        active += 1
        touch(rec)
      }
    }
    const remaining = campaignLeads(c.id).filter((r) => IN_PROGRESS.includes(r.lead.status)).length
    if (remaining === 0) {
      finishCampaign(crec)
      emitCampaign(crec)
    }
  }
}

// ---------------------------------------------------------------------------
// Email changes (rewrite, edit, wrong fact, restore)
// ---------------------------------------------------------------------------

const MODE_LABEL: Record<RewriteMode, string> = {
  shorter: "shorter",
  friendlier: "friendlier",
  more_direct: "more direct",
  another_hook: "another hook",
}

function paragraphIndex(email: Email, kind: Sentence["kind"]) {
  return email.paragraphs.findIndex((p) => p.some((s) => s.kind === kind))
}

function trimClause(text: string) {
  const at = text.indexOf(", which")
  return at > 0 ? `${text.slice(0, at)}.` : text
}

export function rewrite(rec: LeadRecord, mode: RewriteMode, hookId?: string): void {
  const lead = rec.lead
  if (!lead.email) return
  const prev = clone(lead.email)
  const email = clone(lead.email)
  const id = lead.id
  let detail = MODE_LABEL[mode]
  const ctaIdx = email.paragraphs.length - 1
  const offerIdx = paragraphIndex(email, "offer")
  const claimIdx = Math.max(0, paragraphIndex(email, "claim"))

  if (mode === "shorter") {
    if (offerIdx >= 0 && email.paragraphs[offerIdx].length > 1) email.paragraphs[offerIdx] = email.paragraphs[offerIdx].slice(0, 1)
    else if (email.paragraphs[ctaIdx].length > 1) email.paragraphs[ctaIdx] = email.paragraphs[ctaIdx].slice(0, 1)
    email.paragraphs[claimIdx] = email.paragraphs[claimIdx].map((s) =>
      s.text.includes(", which") ? { ...s, id: `${id}-${uid("s")}`, text: trimClause(s.text) } : s
    )
  } else if (mode === "friendlier") {
    email.paragraphs[ctaIdx] = rec.offer.friendlyCta.map((text) => sentence(id, text, "other", [], "none"))
  } else if (mode === "more_direct") {
    email.paragraphs[ctaIdx] = rec.offer.directCta.map((text) => sentence(id, text, "other", [], "none"))
    email.paragraphs[claimIdx] = email.paragraphs[claimIdx]
      .filter((s) => s.kind === "claim" || !/^(That is|That's|It's)/u.test(s.text))
      .map((s) => (s.text.includes(", which") ? { ...s, id: `${id}-${uid("s")}`, text: trimClause(s.text) } : s))
  } else {
    const alternatives = rec.profile.hooks.map((_, i) => i).filter((i) => i !== rec.hookIndex)
    const wanted = hookId ? Number(hookId.replace(/^h/u, "")) - 1 : alternatives[0]
    const next = alternatives.includes(wanted) ? wanted : alternatives[0]
    if (next === undefined) return
    rec.hookIndex = next
    const spec = rec.profile.hooks[next]
    email.subject = spec.subject
    email.paragraphs[claimIdx] = claimSentences(id, rec.profile, next, lead.facts)
    lead.hook = hookObject(id, rec.profile, next)
    lead.alternatives = rec.profile.hooks.map((_, i) => i).filter((i) => i !== next).map((i) => hookObject(id, rec.profile, i))
    detail = `another_hook: ${spec.title}`
  }
  email.version_id = uid("v")
  email.origin = "rewrite"
  email.origin_detail = detail
  email.edited = false
  email.created_at = nowIso()
  lead.previous_email = prev
  lead.email = finalizeEmail(email)
  pushVersion(rec, lead.email)
  recheck(rec)
}

/** Re-runs the mock editor after the email changed. */
function recheck(rec: LeadRecord) {
  const lead = rec.lead
  lead.editor = editorFor(rec, lead.email)
  if (lead.provenance) lead.provenance.drafted_at = lead.email?.created_at ?? lead.provenance.drafted_at
  const problems = (lead.email?.paragraphs ?? []).flat().some((s) => s.state === "check" || s.state === "no_source")
  if (lead.status === "needs_review" && !problems) setStage(rec, "ready")
  if (lead.status === "ready" && problems) setStage(rec, "needs_review")
}

export function applyEdit(rec: LeadRecord, subject: string, body: string) {
  const lead = rec.lead
  if (!lead.email) return
  const old = lead.email
  const parsed = parseBody(body)
  const byText = new Map(old.paragraphs.flat().map((s) => [s.text, s]))
  const paragraphs = parsed.paragraphs.map((texts, pi) =>
    texts.map((text, si): Sentence => {
      const same = byText.get(text)
      if (same) return same
      const at = old.paragraphs[pi]?.[si]
      if (at) {
        return {
          id: `${lead.id}-${uid("s")}`,
          text,
          kind: at.kind,
          fact_ids: at.fact_ids,
          state: at.kind === "claim" ? "check" : "none",
          edited: true,
        }
      }
      return sentence(lead.id, text, "other", [], "none", true)
    })
  )
  const email: Email = {
    ...old,
    version_id: uid("v"),
    subject: subject.trim(),
    greeting: parsed.greeting,
    paragraphs,
    signoff: parsed.signoff,
    edited: true,
    origin: "edit",
    origin_detail: null,
    created_at: nowIso(),
  }
  lead.previous_email = null
  lead.email = finalizeEmail(email)
  pushVersion(rec, lead.email)
  recheck(rec)
}

export function removeWrongFact(rec: LeadRecord, factId: string) {
  const lead = rec.lead
  lead.facts = lead.facts.map((f) => (f.id === factId ? { ...f, flagged_wrong: true, used: false } : f))
  if (!lead.email) return
  const prev = clone(lead.email)
  const email = clone(lead.email)
  email.paragraphs = email.paragraphs
    .map((p) =>
      p
        .map((s) => {
          if (!s.fact_ids.includes(factId)) return s
          const rest = s.fact_ids.filter((id) => id !== factId)
          return rest.length > 0 ? { ...s, fact_ids: rest } : null
        })
        .filter((s): s is Sentence => s !== null)
    )
    .filter((p) => p.length > 0)
  if (!email.paragraphs.some((p) => p.some((s) => s.kind === "claim"))) {
    // keep at least one sourced sentence about the business
    const usable = lead.facts.find((f) => !f.flagged_wrong && f.source_kind !== "listing")
    if (usable) {
      email.paragraphs.unshift([
        sentence(lead.id, `I saw on your ${usable.source_label} that ${usable.text.charAt(0).toLowerCase()}${usable.text.slice(1)}`, "claim", [usable.id], "supported"),
      ])
    }
  }
  email.version_id = uid("v")
  email.origin = "rewrite"
  email.origin_detail = "removed a wrong fact"
  email.created_at = nowIso()
  lead.previous_email = prev
  lead.email = finalizeEmail(email)
  pushVersion(rec, lead.email)
  recheck(rec)
}

export function restore(rec: LeadRecord, versionId: string): boolean {
  const found = rec.versions.find((v) => v.version_id === versionId)
  if (!found) return false
  const email = clone(found)
  email.version_id = uid("v")
  email.origin = "restore"
  email.origin_detail = found.origin_detail ? `restored ${found.origin_detail}` : `restored ${found.origin}`
  email.created_at = nowIso()
  rec.lead.previous_email = null
  rec.lead.email = finalizeEmail(email)
  pushVersion(rec, rec.lead.email)
  recheck(rec)
  return true
}

/** Puts a failed lead back into research. */
export function retry(rec: LeadRecord, mode: "retry" | "without_site") {
  const lead = rec.lead
  lead.error = null
  lead.can_retry = false
  rec.withoutSite = mode === "without_site"
  if (rec.withoutSite) {
    // Use a hook that only needs listing facts, when the profile has one.
    const listingOnly = rec.profile.hooks.findIndex((hook) =>
      hook.facts.every((key) => rec.profile.facts.find((f) => f.key === key)?.listing)
    )
    rec.hookIndex = listingOnly >= 0 ? listingOnly : 0
  }
  lead.facts = []
  lead.email = null
  lead.editor = null
  lead.hook = null
  lead.alternatives = []
  lead.previous_email = null
  rec.versions = []
  setStage(rec, "queued")
  rec.stageEndsAt = null
  const crec = db.campaigns.get(lead.campaign_id)
  if (crec && crec.campaign.status === "done") {
    crec.campaign.status = "researching"
    crec.campaign.finished_at = null
    crec.campaign.finish_summary = null
    crec.startedAt = Date.now()
  }
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

function seedLead(
  crec: CampaignRecord,
  profile: C.Profile,
  status: LeadStatus,
  opts: {
    createdAgo: number
    updatedAgo?: number
    approvedAgo?: number
    sentAgo?: number
    repliedAgo?: number
    outcome?: Lead["reply_outcome"]
    skipReason?: string
    error?: string
  }
): LeadRecord {
  const rec = addLead(crec, profile, { createdAgo: opts.createdAgo })
  const lead = rec.lead
  if (status === "failed") {
    setStage(rec, "failed")
    lead.error = opts.error ?? "Couldn't read site"
    lead.can_retry = true
    lead.cost_usd = 0.004
  } else if (!IN_PROGRESS.includes(status)) {
    fillThrough(rec, "done")
    setStage(rec, status)
    if (opts.approvedAgo !== undefined) lead.approved_at = ago(opts.approvedAgo)
    if (opts.sentAgo !== undefined) lead.sent_at = ago(opts.sentAgo)
    if (opts.repliedAgo !== undefined) lead.replied_at = ago(opts.repliedAgo)
    if (opts.outcome) lead.reply_outcome = opts.outcome
    if (opts.skipReason) lead.skip_reason = opts.skipReason
  }
  lead.updated_at = ago(opts.updatedAgo ?? Math.min(opts.createdAgo, opts.sentAgo ?? opts.createdAgo))
  refreshDerived(rec)
  return rec
}

function addCampaign(input: {
  id: string
  name: string
  location: string
  radius: number
  industry: string
  target: number
  status: Campaign["status"]
  createdAgo: number
  finishedAgo?: number
  kind: C.IndustryKind
  input: CampaignInput
  restatement: string
}): CampaignRecord {
  const campaign: Campaign = {
    id: input.id,
    name: input.name,
    location_label: input.location,
    radius_mi: input.radius,
    industry: input.industry,
    status: input.status,
    status_detail: null,
    lead_target: input.target,
    counts: countsFor(input.id),
    eta_seconds: null,
    created_at: ago(input.createdAgo),
    finished_at: input.finishedAgo !== undefined ? ago(input.finishedAgo) : null,
    input: input.input,
    restatement: input.restatement,
    categories: [],
    question_answer: null,
    notices: [],
    finish_summary: null,
    cost_usd: 0,
  }
  const crec: CampaignRecord = {
    campaign,
    offer: C.offerFor(input.kind),
    kind: input.kind,
    findingUntil: null,
    pending: [],
    reserve: [],
    replaced: [],
    startedAt: Date.now() - input.createdAgo,
  }
  db.campaigns.set(campaign.id, crec)
  db.campaignOrder.push(campaign.id)
  return crec
}

function seed() {
  // --- 1. Live campaign: Dentists within 5 mi of Arlington, VA ---------------
  const dentalInput: CampaignInput = {
    location: "Arlington, VA",
    radius_mi: 5,
    industry: "Dentists",
    offer_what: "Google Ads for dental practices",
    offer_proof: "Grew bookings 30% for a Fairfax practice",
    offer_cta: "Free 15-minute audit",
    tone: "professional",
    lead_target: 10,
  }
  const live = addCampaign({
    id: "c1",
    name: "Dentists within 5 mi of Arlington, VA",
    location: "Arlington, VA",
    radius: 5,
    industry: "Dentists",
    target: 10,
    status: "researching",
    createdAgo: 6 * MINUTE,
    kind: "dental",
    input: dentalInput,
    restatement:
      "General and family dentists within 5 miles of Arlington, VA. Leaving out chains with 10 or more locations.",
  })
  live.campaign.categories = [
    { key: "general_dentistry", label: "General dentistry", count: 38 },
    { key: "orthodontist", label: "Orthodontists", count: 9 },
    { key: "pediatric_dentist", label: "Pediatric dentists", count: 6 },
  ]
  live.campaign.question_answer = { text: "Include orthodontists?", answer: "yes" }
  live.reserve = [C.WELLNESS]

  seedLead(live, C.STUDIO, "ready", { createdAgo: 5.6 * MINUTE, updatedAgo: 4 * MINUTE })
  seedLead(live, C.FAMILY, "ready", { createdAgo: 5.5 * MINUTE, updatedAgo: 3.5 * MINUTE })
  seedLead(live, C.PEDIATRIC, "needs_review", { createdAgo: 5.4 * MINUTE, updatedAgo: 2.5 * MINUTE })
  seedLead(live, C.BRIGHT, "sent", {
    createdAgo: 5.7 * MINUTE,
    approvedAgo: 3 * MINUTE,
    sentAgo: 2 * MINUTE,
  })
  seedLead(live, C.ARTS, "failed", { createdAgo: 5.3 * MINUTE, updatedAgo: 4.5 * MINUTE, error: "Couldn't read site" })

  const ortho = addLead(live, C.ORTHO, { createdAgo: 5.2 * MINUTE })
  fillThrough(ortho, "writing")
  startStage(ortho, "writing", 3000 / Math.max(speed(), 0.0001))
  const smiles = addLead(live, C.SMILES, { createdAgo: 5.1 * MINUTE })
  startStage(smiles, "reading", 2500 / Math.max(speed(), 0.0001))
  const care = addLead(live, C.DENTAL_CARE, {
    createdAgo: 5 * MINUTE,
    replaceReason: "Its site says the office closed in August.",
  })
  startStage(care, "reading", 5500 / Math.max(speed(), 0.0001))
  addLead(live, C.SMILE_CENTER, { createdAgo: 4.9 * MINUTE })
  addLead(live, C.GENTLE, { createdAgo: 4.8 * MINUTE })
  for (const rec of campaignLeads("c1")) refreshDerived(rec)
  refreshCampaign(live)

  // --- 2. Finished: HVAC within 10 mi of Fairfax, VA -------------------------
  const hvacInput: CampaignInput = {
    location: "Fairfax, VA",
    radius_mi: 10,
    industry: "HVAC",
    offer_what: "Google Ads for home service companies",
    offer_proof: "Doubled spring tune-up calls for a Vienna HVAC company",
    offer_cta: "Free 15-minute audit",
    tone: "professional",
    lead_target: 12,
  }
  const hvac = addCampaign({
    id: "c2",
    name: "HVAC within 10 mi of Fairfax, VA",
    location: "Fairfax, VA",
    radius: 10,
    industry: "HVAC",
    target: 12,
    status: "done",
    createdAgo: 3 * DAY,
    finishedAgo: 3 * DAY - 6 * MINUTE,
    kind: "hvac",
    input: hvacInput,
    restatement: "Heating and air conditioning contractors within 10 miles of Fairfax, VA. Leaving out chains with 10 or more locations.",
  })
  const hvacNames = C.namePool("hvac", "HVAC")
  const hvacPlan: [LeadStatus, Partial<Parameters<typeof seedLead>[3]>][] = [
    ["replied", { approvedAgo: 3 * DAY, sentAgo: 3 * DAY - HOUR, repliedAgo: 1 * DAY, outcome: "interested" }],
    ["sent", { approvedAgo: 2 * DAY, sentAgo: 26 * HOUR }],
    ["sent", { approvedAgo: 2 * DAY, sentAgo: 4 * HOUR }],
    ["sent", { approvedAgo: 2 * DAY, sentAgo: 3 * HOUR }],
    ["sent", { approvedAgo: 1 * DAY, sentAgo: 2.5 * HOUR }],
    ["sent", { approvedAgo: 1 * DAY, sentAgo: 1.5 * HOUR }],
    ["approved", { approvedAgo: 20 * HOUR }],
    ["approved", { approvedAgo: 19 * HOUR }],
    ["ready", {}],
    ["skipped", { skipReason: "Already a client" }],
    ["skipped", { skipReason: "Not a fit" }],
    ["failed", { error: "Research hit the cost limit" }],
  ]
  const fairfaxStreets = ["Example Pkwy", "Example Rd", "Example Ave", "Example Blvd", "Example Ct", "Example Way"]
  hvacPlan.forEach(([status, opts], i) => {
    const profile = C.compactProfile({
      name: hvacNames[i],
      category: "HVAC contractor",
      locality: "Fairfax, VA",
      distance: Number((1.4 + i * 0.7).toFixed(1)),
      fit: 91 - i * 3,
      kind: "hvac",
      seed: i,
      street: `${3000 + i * 110} ${fairfaxStreets[i % fairfaxStreets.length]}`,
      zip: "22030",
      areaCode: "571",
      phoneSuffix: String(10 + i).padStart(2, "0"),
      contact: i === 4 ? "form" : "email",
    })
    seedLead(hvac, profile, status, { createdAgo: 3 * DAY - i * MINUTE, ...opts })
  })
  finishSeeded(hvac)

  // --- 3. Finished: Law firms within 5 mi of Alexandria, VA -------------------
  const lawInput: CampaignInput = {
    location: "Alexandria, VA",
    radius_mi: 5,
    industry: "Law firms",
    offer_what: "Google Ads for law firms",
    offer_proof: "Cut cost per consultation 40% for a Fairfax firm",
    offer_cta: "Free 15-minute audit",
    tone: "professional",
    lead_target: 8,
  }
  const law = addCampaign({
    id: "c3",
    name: "Law firms within 5 mi of Alexandria, VA",
    location: "Alexandria, VA",
    radius: 5,
    industry: "Law firms",
    target: 8,
    status: "done",
    createdAgo: 8 * DAY,
    finishedAgo: 8 * DAY - 5 * MINUTE,
    kind: "law",
    input: lawInput,
    restatement: "Law firms within 5 miles of Alexandria, VA. Leaving out chains with 10 or more locations.",
  })
  const lawNames = C.namePool("law", "Law firms")
  const lawPlan: [LeadStatus, Partial<Parameters<typeof seedLead>[3]>][] = [
    ["replied", { approvedAgo: 8 * DAY, sentAgo: 7 * DAY, repliedAgo: 6 * DAY, outcome: "no_thanks" }],
    ["replied", { approvedAgo: 8 * DAY, sentAgo: 7 * DAY, repliedAgo: 5 * DAY, outcome: "interested" }],
    ["sent", { approvedAgo: 7 * DAY, sentAgo: 6 * DAY }],
    ["sent", { approvedAgo: 7 * DAY, sentAgo: 6 * DAY }],
    ["sent", { approvedAgo: 6 * DAY, sentAgo: 30 * MINUTE }],
    ["sent", { approvedAgo: 6 * DAY, sentAgo: 20 * MINUTE }],
    ["skipped", { skipReason: "Wrong place" }],
    ["dnc", {}],
  ]
  lawPlan.forEach(([status, opts], i) => {
    const profile = C.compactProfile({
      name: lawNames[i],
      category: "Law firm",
      locality: "Alexandria, VA",
      distance: Number((0.8 + i * 0.5).toFixed(1)),
      fit: 89 - i * 3,
      kind: "law",
      seed: i,
      street: `${100 + i * 40} Example St`,
      zip: "22314",
      areaCode: "703",
      phoneSuffix: String(40 + i).padStart(2, "0"),
    })
    const rec = seedLead(law, profile, status, { createdAgo: 8 * DAY - i * MINUTE, ...opts })
    if (status === "dnc" || opts?.outcome === "no_thanks") {
      db.dnc.push({
        id: uid("d"),
        business_name: rec.lead.name,
        domain: domainOf(rec.lead.website),
        email: rec.lead.contact?.email ?? null,
        reason: status === "dnc" ? "Asked not to be contacted" : "Replied no thanks",
        source: status === "dnc" ? "lead" : "reply",
        created_at: ago(status === "dnc" ? 7 * DAY : 6 * DAY),
      })
    }
  })
  finishSeeded(law)

  db.dnc.push({
    id: uid("d"),
    business_name: "Sample Roofing Co.",
    domain: "sampleroofing.example",
    email: null,
    reason: "Existing client",
    source: "user",
    created_at: ago(12 * DAY),
  })

  // newest campaign first
  db.campaignOrder = ["c1", "c2", "c3"]
}

function finishSeeded(crec: CampaignRecord) {
  refreshCampaign(crec)
  const records = campaignLeads(crec.campaign.id)
  const c = crec.campaign
  c.finish_summary = {
    found: c.counts.total,
    ready: c.counts.total - c.counts.failed - c.counts.needs_review,
    needs_review: c.counts.needs_review,
    failed: records
      .filter((r) => r.lead.status === "failed")
      .map((r) => ({ lead_id: r.lead.id, name: r.lead.name, reason: r.lead.error ?? "Couldn't finish" })),
    replaced: [],
    seconds: 312,
  }
  c.cost_usd = Number(records.reduce((sum, r) => sum + r.lead.cost_usd, 0).toFixed(4))
}

/** Creates a campaign from the New campaign flow and starts finding businesses. */
export function startCampaign(input: CampaignInput, label: string): CampaignRecord {
  const kind = C.industryKind(input.industry)
  const id = uid("c")
  const crec = addCampaign({
    id,
    name: `${input.industry.trim()} within ${input.radius_mi} mi of ${label}`,
    location: label,
    radius: input.radius_mi,
    industry: input.industry.trim(),
    target: input.lead_target,
    status: "finding",
    createdAgo: 0,
    kind,
    input,
    restatement: `${input.industry.trim()} within ${input.radius_mi} miles of ${label}. Leaving out chains with 10 or more locations.`,
  })
  db.campaignOrder = [id, ...db.campaignOrder.filter((cid) => cid !== id)]
  crec.campaign.status_detail = `Finding businesses near ${label}…`
  crec.findingUntil = Date.now() + Math.min(stageMs(), 2600)
  const names = C.namePool(kind, input.industry)
  const category =
    kind === "dental" ? "Dentist" : kind === "hvac" ? "HVAC contractor" : kind === "law" ? "Law firm" : input.industry.trim().replace(/s$/iu, "")
  const total = Math.min(input.lead_target + 1, names.length)
  const profiles = Array.from({ length: total }, (_, i) =>
    C.compactProfile({
      name: names[i],
      category,
      locality: label,
      distance: Number(Math.min(input.radius_mi, 0.6 + i * (input.radius_mi / (total + 1))).toFixed(1)),
      fit: Math.max(48, 93 - i * 3 - (i % 3)),
      kind,
      seed: i + 3,
      street: `${200 + i * 35} Example St`,
      zip: "00000",
      areaCode: "555",
      phoneSuffix: String(i).padStart(2, "0"),
      contact: i % 5 === 2 ? "form" : i % 7 === 4 ? "none" : "email",
    })
  )
  crec.pending = profiles.slice(0, input.lead_target).map((profile, i) => ({
    profile,
    replaceReason: i === 3 && input.lead_target >= 6 ? "Its listing says it closed this year." : undefined,
    failReason: i === 5 && input.lead_target >= 8 ? "Couldn't read site" : undefined,
  }))
  crec.reserve = profiles.slice(input.lead_target)
  refreshCampaign(crec)
  db.usageUsed = Math.min(100, db.usageUsed)
  return crec
}

seed()
setInterval(tick, 400)

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function recordAction(
  rec: LeadRecord,
  action: ActionRecord["action"],
  dncEntryId: string | null,
  before: ActionRecord["before"]
): string {
  const id = uid("a")
  const createdAt = nowIso()
  db.actions.set(id, { id, leadId: rec.lead.id, action, before, dncEntryId, createdAt })
  rec.actions.push(id)
  rec.lead.last_action = { action_id: id, action, created_at: createdAt }
  return id
}

export function snapshot(lead: Lead): ActionRecord["before"] {
  return {
    status: lead.status,
    approved_at: lead.approved_at,
    sent_at: lead.sent_at,
    replied_at: lead.replied_at,
    reply_outcome: lead.reply_outcome,
    skip_reason: lead.skip_reason,
  }
}

export function lastActionOf(rec: LeadRecord) {
  const id = rec.actions[rec.actions.length - 1]
  const action = id ? db.actions.get(id) : undefined
  rec.lead.last_action = action ? { action_id: action.id, action: action.action, created_at: action.createdAt } : null
}

export function addDnc(entry: Omit<DncEntry, "id" | "created_at">): DncEntry {
  const full: DncEntry = { id: uid("d"), created_at: nowIso(), ...entry }
  db.dnc.unshift(full)
  return full
}

export { STAGE_LABEL, IN_PROGRESS }
