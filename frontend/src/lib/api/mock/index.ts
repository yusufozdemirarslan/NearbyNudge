// Development-only mock adapter: the whole API in memory, with a campaign that
// progresses live. Enabled by `npm run dev:mock`; removed from production
// builds (see src/lib/api/index.ts).
//
// Mock controls (set in localStorage, then reload):
//   nn-mock-speed       research speed multiplier (default 1; 0 freezes it)
//   nn-mock-sent-today  starting "Sent today" count (default 7; 20 = at the cap)
//   nn-mock-paused      "1" shows the paused banner
//   nn-mock-onboarded   "0" starts without a sender profile (the set-up page)
import type { Api } from "../api"
import { ApiError } from "../client"
import type {
  Account,
  ActionResult,
  CampaignPlan,
  Lead,
  ReplyOutcome,
  SentItem,
} from "../types"
import {
  adminErrors,
  adminOverview,
  aiCalls,
  aiPaused,
  auditSample,
  buildStats,
  optOuts,
  resumeAi,
  setBalance,
  usage,
} from "./fixtures"
import {
  addDnc,
  applyEdit,
  campaignLeads,
  campaignSummaryOf,
  db,
  footerText,
  lastActionOf,
  recordAction,
  removeWrongFact,
  resetWorkspace,
  restore,
  retry,
  rewrite,
  sendingToday,
  snapshot,
  startCampaign,
  subscribe,
  summaryOf,
  touch,
  type LeadRecord,
} from "./store"
import { clone, delay, domainOf, latency, nowIso, uid } from "./util"

/** "https://www.Example.com/contact" → "example.com", like the server keeps a typed website. */
const siteOf = (typed: string | null | undefined): string | null => {
  const text = typed?.trim()
  if (!text) return null
  return domainOf(/^[a-z][a-z0-9+.-]*:\/\//iu.test(text) ? text : `https://${text}`)?.toLowerCase() ?? text.toLowerCase()
}

/** Edits and restores only before approval, with the server's messages. */
const assertChangeable = (rec: { lead: { status: string } }) => {
  if (rec.lead.status === "ready" || rec.lead.status === "needs_review") return
  if (rec.lead.status === "approved") throw new ApiError(409, "conflict", "Undo the approval to change this email.")
  throw new ApiError(409, "conflict", "This email can't be changed now.")
}

const notFound = (what = "That item") =>
  new ApiError(404, "not_found", `${what} doesn't exist or was deleted.`)

function leadRecord(id: string): LeadRecord {
  const rec = db.leads.get(id)
  if (!rec || rec.hidden) throw notFound("That lead")
  return rec
}

function leadOut(rec: LeadRecord): Lead {
  return clone(rec.lead)
}

function account(): Account {
  return clone({
    user: db.user,
    profile: db.profile,
    preferences: db.preferences,
    usage: usage(),
    sending: sendingToday(),
    footer_preview: db.profile ? footerText() : null,
  })
}

function actionResult(rec: LeadRecord, actionId: string): ActionResult {
  return { lead: leadOut(rec), action_id: actionId, sending: sendingToday() }
}

function csv(rows: (string | number | null)[][]): Blob {
  const text = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null ? "" : String(cell)
          return /[",\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value
        })
        .join(",")
    )
    .join("\r\n")
  return new Blob([text], { type: "text/csv" })
}

const GEO = [
  { label: "Arlington, VA", kind: "city" as const },
  { label: "Alexandria, VA", kind: "city" as const },
  { label: "Fairfax, VA", kind: "city" as const },
  { label: "Falls Church, VA", kind: "city" as const },
  { label: "Vienna, VA", kind: "city" as const },
  { label: "Reston, VA", kind: "city" as const },
  { label: "Washington, DC", kind: "city" as const },
  { label: "Bethesda, MD", kind: "city" as const },
  { label: "Silver Spring, MD", kind: "city" as const },
  { label: "22201", kind: "zip" as const },
  { label: "22202", kind: "zip" as const },
  { label: "22203", kind: "zip" as const },
  { label: "22030", kind: "zip" as const },
]

export const mockApi: Api = {
  // ---------- sign-in: the sample data has none (like the app with no password set) ----------
  async getSession() {
    await latency()
    return { enabled: false, signed_in: true, email: null }
  },
  async login() {
    await latency()
    throw new ApiError(404, "not_found", "Sign-in isn't turned on for this copy of NearbyNudge.")
  },
  async logout() {
    await latency()
  },

  // ---------- the workspace ----------
  async getMe() {
    await latency()
    return { user: clone(db.user) }
  },

  // ---------- account ----------
  async getAccount() {
    await latency()
    return account()
  },
  async updateProfile(profile) {
    await latency()
    if (!profile.sender_address.trim()) {
      throw new ApiError(422, "validation", "Add your postal address. The law requires it in every email.", {
        sender_address: "Add your postal address.",
      })
    }
    db.profile = clone(profile)
    db.user.onboarded = true
    db.user.name = profile.sender_name
    for (const rec of db.leads.values()) if (rec.lead.email) touchQuiet(rec)
    return account()
  },
  async updatePreferences(preferences) {
    await latency()
    db.preferences = clone(preferences)
    return account()
  },
  async deleteAccount(req) {
    await latency()
    if (req.confirm.trim().toLowerCase() !== "delete") {
      throw new ApiError(422, "validation", "Type delete to confirm.", { confirm: "Doesn't match." })
    }
    resetWorkspace()
  },
  async getStatus() {
    await latency()
    const paused = aiPaused()
    return {
      ai_state: paused ? "paused" : "ok",
      ai_name: "Claude",
      ai_model: "claude-sonnet-5-5",
      message: paused ? "Research paused. We'll resume automatically, and nothing is lost." : null,
    }
  },

  // ---------- campaigns ----------
  async getCampaigns() {
    await latency()
    return db.campaignOrder.map((id) => campaignSummaryOf(db.campaigns.get(id)!))
  },
  async getLastInput() {
    await latency()
    const latest = db.campaigns.get(db.campaignOrder[0])
    return { input: latest ? clone(latest.campaign.input) : null }
  },
  async planCampaign(input) {
    await delay(1400)
    const fields: Record<string, string> = {}
    if (!input.location.trim()) fields.location = "Enter a city and state, or a ZIP code."
    else if (!/,|\d{5}/u.test(input.location)) fields.location = "Add the state, like \"Springfield, IL\"."
    if (!input.industry.trim()) fields.industry = "Enter who you sell to."
    if (!input.offer_what.trim()) fields.offer_what = "Describe what you sell."
    if (Object.keys(fields).length > 0) throw new ApiError(422, "validation", "Check the highlighted fields.", fields)
    const label = input.location.trim()
    const dental = /dent/iu.test(input.industry)
    const few = input.radius_mi <= 2
    const plan: CampaignPlan = {
      plan_id: uid("plan"),
      location: {
        label,
        kind: /^\d{5}$/u.test(label) ? "zip" : "city",
        lat: 38.88,
        lon: -77.1,
        note: /^\d{5}$/u.test(label) ? null : `Searching from the center of ${label}`,
      },
      restatement: dental
        ? `General and family dentists within ${input.radius_mi} miles of ${label}. Leaving out chains with 10 or more locations.`
        : `${input.industry.trim()} within ${input.radius_mi} miles of ${label}. Leaving out chains with 10 or more locations.`,
      categories: dental
        ? [
            { key: "general_dentistry", label: "General dentistry", count: 38 },
            { key: "pediatric_dentist", label: "Pediatric dentists", count: 6 },
          ]
        : [{ key: "primary", label: input.industry.trim(), count: few ? 6 : 31 }],
      question: dental
        ? { text: "Include orthodontists?", categories: [{ key: "orthodontist", label: "Orthodontists", count: 9 }] }
        : null,
      candidate_count: few ? 6 : dental ? 44 : 31,
      coverage: "ready",
      warnings: few ? ["Only 6 businesses match. Try a 10-mile radius or a broader industry."] : [],
    }
    db.plans.set(plan.plan_id, { input: clone(input), createdAt: Date.now() })
    return plan
  },
  async createCampaign(req) {
    await latency()
    const plan = db.plans.get(req.plan_id)
    if (!plan) throw new ApiError(409, "plan_expired", "This plan has expired. Review the plan again to start.")
    for (const key of ["location", "radius_mi", "industry"] as const) {
      if (String(plan.input[key]) !== String(req.input[key])) {
        throw new ApiError(409, "plan_changed", "The location, radius or industry changed. Review the plan again to start.")
      }
    }
    if (db.usageUsed + req.input.lead_target > 100) {
      throw new ApiError(
        409,
        "usage_limit",
        `You have ${100 - db.usageUsed} leads left this month. Lower the number of businesses or wait until next month.`
      )
    }
    db.plans.delete(req.plan_id)
    const crec = startCampaign(req.input, req.input.location.trim())
    if (req.answer && /dent/iu.test(req.input.industry)) {
      crec.campaign.question_answer = { text: "Include orthodontists?", answer: req.answer }
    }
    return clone(crec.campaign)
  },
  async getCampaign(id) {
    await latency()
    const crec = db.campaigns.get(id)
    if (!crec) throw notFound("That campaign")
    return clone(crec.campaign)
  },
  async deleteCampaign(id) {
    await latency()
    if (!db.campaigns.has(id)) throw notFound("That campaign")
    db.campaigns.delete(id)
    db.campaignOrder = db.campaignOrder.filter((cid) => cid !== id)
    for (const [leadId, rec] of db.leads) if (rec.lead.campaign_id === id) db.leads.delete(leadId)
  },
  async getCampaignLeads(id) {
    await latency()
    if (!db.campaigns.has(id)) throw notFound("That campaign")
    return campaignLeads(id)
      .map((rec) => summaryOf(rec.lead))
      .sort(
        (a, b) =>
          (b.fit_score ?? -1) - (a.fit_score ?? -1) ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
  },
  subscribeCampaign(id, handlers) {
    return subscribe(id, handlers)
  },
  async downloadCampaignCsv(id) {
    await latency()
    const rows: (string | number | null)[][] = [
      ["name", "status", "fit", "distance_mi", "email", "contact_form", "website", "phone", "address", "subject"],
    ]
    for (const rec of campaignLeads(id)) {
      const l = rec.lead
      rows.push([
        l.name,
        l.status,
        l.fit_score,
        l.distance_mi,
        l.contact?.email ?? null,
        l.contact?.form_url ?? null,
        l.website,
        l.phone,
        l.address,
        l.email_subject,
      ])
    }
    return csv(rows)
  },
  async geoSuggest(q) {
    await latency()
    const query = q.trim().toLowerCase()
    return { results: GEO.filter((g) => g.label.toLowerCase().startsWith(query)).slice(0, 8) }
  },
  async getIndustries() {
    await latency()
    return {
      suggestions: [
        "Dentists",
        "HVAC",
        "Law firms",
        "Restaurants",
        "Plumbers",
        "Auto repair",
        "Real estate agents",
        "Accountants",
        "Chiropractors",
        "Salons",
        "Fitness studios",
        "Veterinarians",
      ],
    }
  },

  // ---------- leads ----------
  async getLead(id) {
    await latency()
    return leadOut(leadRecord(id))
  },
  async updateEmail(id, req) {
    await delay(350)
    const rec = leadRecord(id)
    assertChangeable(rec)
    if (!req.subject.trim()) throw new ApiError(422, "validation", "Add a subject.", { subject: "Add a subject." })
    applyEdit(rec, req.subject, req.body)
    touch(rec)
    return leadOut(rec)
  },
  async rewriteLead(id, req, signal) {
    const rec = leadRecord(id)
    const from = rec.lead.status
    const version = rec.lead.email?.version_id
    if (!rec.lead.email || !["ready", "needs_review", "approved"].includes(from)) {
      throw new ApiError(409, "conflict", "This email can't be rewritten right now.")
    }
    await delay(3000, signal)
    if (rec.lead.status !== from || rec.lead.email?.version_id !== version) {
      throw new ApiError(409, "conflict", "This lead changed while the rewrite ran, so the rewrite wasn't applied.")
    }
    rewrite(rec, req.mode, req.hook_id)
    if (rec.lead.status === "approved") {
      // Rewriting an approved email takes the approval back, as on the server.
      rec.lead.status = "ready"
      rec.lead.approved_at = null
    }
    touch(rec)
    return leadOut(rec)
  },
  async restoreVersion(id, versionId) {
    await latency()
    const rec = leadRecord(id)
    assertChangeable(rec)
    if (!restore(rec, versionId)) throw notFound("That version")
    touch(rec)
    return leadOut(rec)
  },
  async approveLead(id) {
    await latency()
    const rec = leadRecord(id)
    if (rec.lead.status !== "ready" && rec.lead.status !== "needs_review") {
      throw new ApiError(409, "conflict", "Only drafts that are ready or need review can be approved.")
    }
    const before = snapshot(rec.lead)
    rec.lead.status = "approved"
    rec.lead.approved_at = nowIso()
    const actionId = recordAction(rec, "approve", null, before)
    touch(rec)
    return actionResult(rec, actionId)
  },
  async skipLead(id, req) {
    await latency()
    const rec = leadRecord(id)
    if (["skipped", "dnc", "sent", "replied"].includes(rec.lead.status)) {
      throw new ApiError(409, "conflict", "This lead can't be skipped now.")
    }
    const before = snapshot(rec.lead)
    rec.lead.status = "skipped"
    rec.lead.skip_reason = req.reason
    rec.lead.stage_label = null
    rec.lead.step = null
    const actionId = recordAction(rec, "skip", null, before)
    touch(rec)
    return actionResult(rec, actionId)
  },
  async dncLead(id, req) {
    await latency()
    const rec = leadRecord(id)
    if (rec.lead.status === "dnc") {
      throw new ApiError(409, "conflict", "This business is already on your do-not-contact list.")
    }
    const before = snapshot(rec.lead)
    const entry = addDnc({
      business_name: rec.lead.name,
      domain: domainOf(rec.lead.website),
      email: rec.lead.contact?.email ?? null,
      reason: req.reason ?? null,
      source: "lead",
    })
    rec.lead.status = "dnc"
    rec.lead.stage_label = null
    rec.lead.step = null
    const actionId = recordAction(rec, "dnc", entry.id, before)
    touch(rec)
    return actionResult(rec, actionId)
  },
  async markSent(id) {
    await latency()
    const rec = leadRecord(id)
    if (rec.lead.status !== "approved") {
      throw new ApiError(409, "conflict", "Approve this email before marking it sent.")
    }
    if (db.sentToday >= db.dailyCap) {
      throw new ApiError(
        409,
        "daily_cap_reached",
        `You've marked ${db.dailyCap} emails as sent today, the daily limit. You can mark more after midnight.`
      )
    }
    const before = snapshot(rec.lead)
    rec.lead.status = "sent"
    rec.lead.sent_at = nowIso()
    db.sentToday += 1
    const actionId = recordAction(rec, "sent", null, before)
    touch(rec)
    return actionResult(rec, actionId)
  },
  async markReplied(id, req) {
    await latency()
    const rec = leadRecord(id)
    if (rec.lead.status !== "sent") {
      throw new ApiError(409, "conflict", "Mark the email as sent before logging a reply.")
    }
    const before = snapshot(rec.lead)
    let entryId: string | null = null
    if (req.outcome === "no_thanks") {
      entryId = addDnc({
        business_name: rec.lead.name,
        domain: domainOf(rec.lead.website),
        email: rec.lead.contact?.email ?? null,
        reason: "Replied no thanks",
        source: "reply",
      }).id
    }
    rec.lead.status = "replied"
    rec.lead.replied_at = nowIso()
    rec.lead.reply_outcome = req.outcome as ReplyOutcome
    const actionId = recordAction(rec, "replied", entryId, before)
    touch(rec)
    return actionResult(rec, actionId)
  },
  async undoAction(actionId) {
    await latency()
    const action = db.actions.get(actionId)
    if (!action) throw notFound("That action")
    const rec = leadRecord(action.leadId)
    if (action.undoneAt) throw new ApiError(409, "conflict", "That action was already undone.")
    if (rec.actions[rec.actions.length - 1] !== actionId || rec.lead.status !== action.afterStatus) {
      throw new ApiError(409, "conflict", "This lead has changed since then, so the action can't be undone.")
    }
    Object.assign(rec.lead, action.before)
    if (action.action === "sent") db.sentToday = Math.max(0, db.sentToday - 1)
    if (action.dncEntryId) db.dnc = db.dnc.filter((entry) => entry.id !== action.dncEntryId)
    rec.actions.pop()
    action.undoneAt = nowIso()
    lastActionOf(rec)
    touch(rec)
    return { lead: leadOut(rec), sending: sendingToday() }
  },
  async retryLead(id, req) {
    await latency()
    const rec = leadRecord(id)
    if (rec.lead.status !== "failed" && rec.lead.status !== "needs_review") {
      throw new ApiError(409, "conflict", "Only leads that couldn't finish or need review can be retried.")
    }
    retry(rec, req.mode)
    touch(rec)
    return leadOut(rec)
  },
  async flagWrongFact(factId, req, signal) {
    void req
    const rec = [...db.leads.values()].find((r) => r.lead.facts.some((f) => f.id === factId))
    if (!rec) throw notFound("That fact")
    await delay(2500, signal)
    removeWrongFact(rec, factId)
    touch(rec)
    return leadOut(rec)
  },
  async logLeadEvent(id, req) {
    await latency()
    leadRecord(id)
    db.events.push({ leadId: id, kind: req.kind, at: nowIso() })
  },

  // ---------- sent, do not contact, numbers ----------
  async getSent(status) {
    await latency()
    const wanted =
      status === "all" ? ["approved", "sent", "replied"] : status === "sent" ? ["sent"] : [status]
    const items: SentItem[] = []
    for (const rec of db.leads.values()) {
      const l = rec.lead
      if (rec.hidden || !wanted.includes(l.status)) continue
      items.push({
        ...summaryOf(l),
        campaign_name: db.campaigns.get(l.campaign_id)?.campaign.name ?? "",
        contact_email: l.contact?.email ?? null,
        approved_at: l.approved_at,
        sent_at: l.sent_at,
        replied_at: l.replied_at,
        reply_outcome: l.reply_outcome,
      })
    }
    const when = (i: SentItem) => new Date(i.replied_at ?? i.sent_at ?? i.approved_at ?? i.updated_at).getTime()
    items.sort((a, b) => when(b) - when(a))
    return { items, sending: sendingToday() }
  },
  async getDnc(q) {
    await latency()
    const query = (q ?? "").trim().toLowerCase()
    return clone(
      db.dnc.filter(
        (entry) =>
          !query ||
          [entry.business_name, entry.domain, entry.email].some((v) => v?.toLowerCase().includes(query))
      )
    )
  },
  async createDnc(req) {
    await latency()
    if (!req.business_name?.trim() && !req.domain?.trim() && !req.email?.trim()) {
      throw new ApiError(422, "validation", "Add a business name, a website or an email address.", {
        business_name: "Add at least one of these.",
      })
    }
    return clone(
      addDnc({
        business_name: req.business_name?.trim() || null,
        domain: siteOf(req.domain),
        email: req.email?.trim().toLowerCase() || null,
        reason: req.reason?.trim() || null,
        source: "user",
      })
    )
  },
  async deleteDnc(id) {
    await latency()
    if (!db.dnc.some((entry) => entry.id === id)) throw notFound("That entry")
    db.dnc = db.dnc.filter((entry) => entry.id !== id)
  },
  async downloadDncCsv() {
    await latency()
    return csv([
      ["business_name", "domain", "email", "reason", "source", "created_at"],
      ...db.dnc.map((e) => [e.business_name, e.domain, e.email, e.reason, e.source, e.created_at]),
    ])
  },
  async getStats() {
    await latency()
    return buildStats()
  },
  async downloadStatsCsv() {
    await latency()
    const stats = buildStats()
    return csv([
      ["week_start", "found", "approved", "sent", "replied"],
      ...stats.weekly.map((w) => [w.week_start, w.found, w.approved, w.sent, w.replied]),
    ])
  },

  // ---------- admin ----------
  async getAdminOverview() {
    await latency()
    return adminOverview()
  },
  async setAdminBalance(req) {
    await latency()
    setBalance(req.amount)
    return adminOverview()
  },
  async resumeAi() {
    await latency()
    resumeAi()
    return adminOverview()
  },
  async getAdminErrors() {
    await latency()
    return clone(adminErrors)
  },
  async getAiCalls(limit = 50) {
    await latency()
    return aiCalls(limit)
  },
  async getAuditSample(n = 10) {
    await latency()
    return clone(auditSample(n))
  },
  async setAuditVerdict() {
    await latency()
    return { ok: true }
  },
  async getOptOuts() {
    await latency()
    return clone(optOuts)
  },
  async createOptOut(req) {
    await latency()
    const entry = {
      id: uid("o"),
      domain: req.domain,
      contact_email: req.contact_email ?? null,
      note: req.note ?? null,
      created_at: nowIso(),
    }
    optOuts.unshift(entry)
    return clone(entry)
  },
  async deleteOptOut(id) {
    await latency()
    const index = optOuts.findIndex((o) => o.id === id)
    if (index >= 0) optOuts.splice(index, 1)
  },

  // ---------- public ----------
  async publicOptOut(req) {
    await latency()
    if (!req.domain.trim()) {
      throw new ApiError(422, "validation", "Enter your website's domain.", { domain: "Enter your domain." })
    }
    return { ok: true, message: "Thanks. NearbyNudgeBot will stay away from your site within 2 business days." }
  },
  async getHealth() {
    await latency()
    return { ok: true, version: "2.0.0-mock" }
  },
}

/** Refreshes a lead's derived fields (footer, copy text) without an event. */
function touchQuiet(rec: LeadRecord) {
  if (rec.lead.email) rec.lead.email.footer = footerText()
  touch(rec)
}
