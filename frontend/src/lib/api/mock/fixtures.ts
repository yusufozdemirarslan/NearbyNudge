// Numbers and admin console data for the mock adapter (dev only).
import type {
  AdminOverview,
  AiCallRow,
  AuditLead,
  ErrorEntry,
  Funnel,
  OptOut,
  Stats,
  Usage,
} from "../types"
import { campaignLeads, db, sendingToday } from "./store"
import { ago, DAY, HOUR, MINUTE, mondayOf } from "./util"

const DRAFTED = new Set(["ready", "needs_review", "approved", "sent", "replied", "skipped", "dnc"])

function funnelOf(statuses: string[]): Funnel {
  return {
    found: statuses.filter((s) => DRAFTED.has(s)).length,
    approved: statuses.filter((s) => s === "approved" || s === "sent" || s === "replied").length,
    sent: statuses.filter((s) => s === "sent" || s === "replied").length,
    replied: statuses.filter((s) => s === "replied").length,
  }
}

export function usage(): Usage {
  return { used: db.usageUsed, limit: 100, month_label: "October 2026" }
}

export function buildStats(): Stats {
  const all = [...db.leads.values()].filter((r) => !r.hidden).map((r) => r.lead.status)
  const totals = funnelOf(all)
  // Seven earlier weeks of history, then this week from live data.
  const history: Funnel[] = [
    { found: 9, approved: 5, sent: 4, replied: 0 },
    { found: 14, approved: 9, sent: 7, replied: 1 },
    { found: 12, approved: 8, sent: 6, replied: 0 },
    { found: 18, approved: 12, sent: 9, replied: 1 },
    { found: 16, approved: 11, sent: 9, replied: 2 },
    { found: 21, approved: 13, sent: 10, replied: 1 },
    { found: 8, approved: 6, sent: 6, replied: 2 },
  ]
  const thisWeek = funnelOf(
    [...db.leads.values()]
      .filter((r) => !r.hidden && Date.now() - new Date(r.lead.created_at).getTime() < 7 * DAY)
      .map((r) => r.lead.status)
  )
  const weekly = [...history, thisWeek].map((f, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (7 - i) * 7)
    return { ...f, week_start: mondayOf(d) }
  })
  const byCampaign = db.campaignOrder.map((id) => {
    const crec = db.campaigns.get(id)!
    return {
      ...funnelOf(campaignLeads(id).map((r) => r.lead.status)),
      campaign_id: id,
      name: crec.campaign.name,
      created_at: crec.campaign.created_at,
    }
  })
  const historicTotals = history.reduce(
    (acc, f) => ({
      found: acc.found + f.found,
      approved: acc.approved + f.approved,
      sent: acc.sent + f.sent,
      replied: acc.replied + f.replied,
    }),
    totals
  )
  return {
    totals: {
      ...historicTotals,
      reply_rate: historicTotals.sent > 0 ? historicTotals.replied / historicTotals.sent : null,
    },
    this_week: thisWeek,
    last_week: history[history.length - 1],
    weekly,
    by_campaign: byCampaign,
    sending: sendingToday(),
    usage: usage(),
  }
}

let balance = { amount: 50 as number | null, as_of: ago(12 * DAY) }
let aiPausedSince: string | null = null

export function setBalance(amount: number) {
  balance = { amount, as_of: new Date().toISOString() }
}

export function resumeAi() {
  aiPausedSince = null
  try {
    window.localStorage.removeItem("nn-mock-paused")
  } catch {
    // ignore
  }
}

export function aiPaused(): boolean {
  try {
    return window.localStorage.getItem("nn-mock-paused") === "1"
  } catch {
    return false
  }
}

export function adminOverview(): AdminOverview {
  const daily = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * DAY)
    const requests = 120 + ((i * 37) % 140)
    return {
      date: d.toISOString().slice(0, 10),
      requests,
      cost: Number((requests * 0.0041).toFixed(2)),
    }
  })
  const d7 = daily.slice(-7).reduce((sum, d) => sum + d.cost, 0)
  const d30 = daily.reduce((sum, d) => sum + d.cost, 0)
  const spentSince = daily.slice(-12).reduce((sum, d) => sum + d.cost, 0)
  const remaining = balance.amount === null ? null : Math.max(0, balance.amount - spentSince)
  const avgDaily = d7 / 7
  const paused = aiPaused()
  return {
    ai: {
      state: paused ? "paused" : "ok",
      reason: paused ? "balance" : null,
      since: paused ? (aiPausedSince ?? ago(20 * MINUTE)) : null,
      model: "claude-sonnet-5-5",
      web_search: "available",
    },
    spend: {
      today: daily[daily.length - 1].cost,
      d7: Number(d7.toFixed(2)),
      d30: Number(d30.toFixed(2)),
      per_lead_avg: 0.038,
      requests_today: daily[daily.length - 1].requests,
      by_skill: [
        { skill: "planner", requests: 14, cost: 0.02, avg_latency_ms: 2900 },
        { skill: "scout", requests: 9, cost: 0.06, avg_latency_ms: 4100 },
        { skill: "researcher", requests: 88, cost: 0.41, avg_latency_ms: 6800 },
        { skill: "writer", requests: 71, cost: 0.22, avg_latency_ms: 9200 },
        { skill: "editor", requests: 64, cost: 0.17, avg_latency_ms: 5400 },
      ],
      daily,
    },
    balance: {
      amount: balance.amount,
      as_of: balance.as_of,
      spent_since: Number(spentSince.toFixed(2)),
      remaining: remaining === null ? null : Number(remaining.toFixed(2)),
      avg_daily: Number(avgDaily.toFixed(2)),
      days_left: remaining === null || avgDaily === 0 ? null : Math.floor(remaining / avgDaily),
    },
    queue: { queued: 2, running: 3, failed_24h: 1 },
    quality: {
      audited_facts: 214,
      supported_pct: 97.7,
      leads_with_contact_pct: 71,
      avg_cost_per_lead: 0.038,
    },
  }
}

export const adminErrors: ErrorEntry[] = [
  {
    id: "e1",
    created_at: ago(40 * MINUTE),
    where: "reader",
    message: "sampledentalarts.example timed out after 15 s (3 attempts).",
    campaign_id: "c1",
    lead_id: null,
  },
  {
    id: "e2",
    created_at: ago(3 * HOUR),
    where: "ai",
    message: "Rate limited (429). Retried after 4 s and succeeded.",
    campaign_id: null,
    lead_id: null,
  },
  {
    id: "e3",
    created_at: ago(2 * DAY),
    where: "pipeline",
    message: "Lead reached the $0.10 research limit and stopped.",
    campaign_id: "c2",
    lead_id: null,
  },
]

export function aiCalls(limit: number): AiCallRow[] {
  const skills = ["researcher", "writer", "editor", "scout", "planner"]
  return Array.from({ length: Math.min(limit, 50) }, (_, i) => {
    const skill = skills[i % skills.length]
    const error = i === 7
    const prompt = 3000 + ((i * 911) % 9000)
    const completion = 300 + ((i * 131) % 1200)
    return {
      id: `call${i + 1}`,
      created_at: ago(i * 3 * MINUTE + 40_000),
      skill,
      thinking: skill === "writer" || skill === "editor",
      prompt_tokens: prompt,
      cached_tokens: i % 3 === 0 ? Math.round(prompt * 0.6) : 0,
      completion_tokens: completion,
      web_search_calls: skill === "scout" && i % 2 === 0 ? 1 : 0,
      cost_usd: Number((prompt * 0.000003 + completion * 0.000015).toFixed(4)),
      latency_ms: 2000 + ((i * 577) % 9000),
      status: error ? "error" : "ok",
      error: error ? "Overloaded (529). Retried once." : null,
    }
  })
}

export function auditSample(n: number): AuditLead[] {
  const records = [...db.leads.values()].filter((r) => !r.hidden && r.lead.facts.length > 0)
  return records.slice(0, n).map((r) => ({
    lead_id: r.lead.id,
    name: r.lead.name,
    campaign_name: db.campaigns.get(r.lead.campaign_id)?.campaign.name ?? "",
    website: r.lead.website,
    email_subject: r.lead.email_subject,
    facts: r.lead.facts.map((fact) => ({ fact, verdict: null })),
  }))
}

export const optOuts: OptOut[] = [
  {
    id: "o1",
    domain: "sampleoptout.example",
    contact_email: "owner@sampleoptout.example",
    note: "Please don't read our site.",
    created_at: ago(9 * DAY),
  },
  {
    id: "o2",
    domain: "samplequiet.example",
    contact_email: null,
    note: null,
    created_at: ago(20 * DAY),
  },
]
