import type { Api, CampaignStreamHandlers } from "./api"
import { request, requestBlob } from "./client"
import type { CampaignSummary, LeadSummary } from "./types"

const enc = encodeURIComponent

/**
 * Opens GET /api/campaigns/{id}/events. The browser's EventSource retries
 * dropped connections by itself; if the server closes the stream for good
 * (non-200 response) we retry with a growing delay, up to 30 s.
 */
function subscribeCampaign(id: string, handlers: CampaignStreamHandlers) {
  let source: EventSource | null = null
  let closed = false
  let opens = 0
  let retryDelay = 2000
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const parse = <T,>(event: MessageEvent): T | null => {
    try {
      return JSON.parse(event.data) as T
    } catch {
      return null
    }
  }

  const connect = () => {
    if (closed) return
    source = new EventSource(`/api/campaigns/${enc(id)}/events`)
    source.addEventListener("open", () => {
      retryDelay = 2000
      handlers.onOpen?.({ reconnected: opens > 0 })
      opens += 1
    })
    source.addEventListener("lead", (event) => {
      const lead = parse<LeadSummary>(event as MessageEvent)
      if (lead) handlers.onLead?.(lead)
    })
    source.addEventListener("campaign", (event) => {
      const campaign = parse<CampaignSummary>(event as MessageEvent)
      if (campaign) handlers.onCampaign?.(campaign)
    })
    source.addEventListener("error", () => {
      handlers.onError?.()
      if (source?.readyState === EventSource.CLOSED && !closed) {
        source.close()
        retryTimer = setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30_000)
      }
    })
  }

  connect()
  return () => {
    closed = true
    if (retryTimer) clearTimeout(retryTimer)
    source?.close()
  }
}

/** The real API over HTTP, same origin. */
export const httpApi: Api = {
  // the workspace and its settings
  getMe: () => request("GET", "/api/me"),
  getAccount: () => request("GET", "/api/account"),
  updateProfile: (profile) => request("PUT", "/api/account/profile", profile),
  updatePreferences: (preferences) =>
    request("PUT", "/api/account/preferences", preferences),
  deleteAccount: (req) => request("DELETE", "/api/account", req),
  getStatus: () => request("GET", "/api/status"),

  // campaigns
  getCampaigns: () => request("GET", "/api/campaigns"),
  getLastInput: () => request("GET", "/api/campaigns/last-input"),
  planCampaign: (input) => request("POST", "/api/campaigns/plan", input),
  createCampaign: (req) => request("POST", "/api/campaigns", req),
  getCampaign: (id) => request("GET", `/api/campaigns/${enc(id)}`),
  deleteCampaign: (id) => request("DELETE", `/api/campaigns/${enc(id)}`),
  getCampaignLeads: (id) => request("GET", `/api/campaigns/${enc(id)}/leads`),
  subscribeCampaign,
  downloadCampaignCsv: (id) =>
    requestBlob(`/api/campaigns/${enc(id)}/export.csv`),
  geoSuggest: (q) => request("GET", `/api/geo/suggest?q=${enc(q)}`),
  getIndustries: () => request("GET", "/api/industries"),

  // leads
  getLead: (id) => request("GET", `/api/leads/${enc(id)}`),
  updateEmail: (id, req) => request("PUT", `/api/leads/${enc(id)}/email`, req),
  rewriteLead: (id, req, signal) =>
    request("POST", `/api/leads/${enc(id)}/rewrite`, req, { signal }),
  restoreVersion: (id, versionId) =>
    request(
      "POST",
      `/api/leads/${enc(id)}/versions/${enc(versionId)}/restore`,
      {}
    ),
  approveLead: (id) => request("POST", `/api/leads/${enc(id)}/approve`, {}),
  skipLead: (id, req) => request("POST", `/api/leads/${enc(id)}/skip`, req),
  dncLead: (id, req) => request("POST", `/api/leads/${enc(id)}/dnc`, req),
  markSent: (id) => request("POST", `/api/leads/${enc(id)}/sent`, {}),
  markReplied: (id, req) => request("POST", `/api/leads/${enc(id)}/replied`, req),
  undoAction: (actionId) =>
    request("POST", `/api/actions/${enc(actionId)}/undo`, {}),
  retryLead: (id, req) => request("POST", `/api/leads/${enc(id)}/retry`, req),
  flagWrongFact: (factId, req, signal) =>
    request("POST", `/api/facts/${enc(factId)}/wrong`, req, { signal }),
  logLeadEvent: (id, req) => request("POST", `/api/leads/${enc(id)}/events`, req),

  // sent, do not contact, numbers
  getSent: (status) => request("GET", `/api/sent?status=${enc(status)}`),
  getDnc: (q) =>
    request("GET", q ? `/api/dnc?q=${enc(q)}` : "/api/dnc"),
  createDnc: (req) => request("POST", "/api/dnc", req),
  deleteDnc: (id) => request("DELETE", `/api/dnc/${enc(id)}`),
  downloadDncCsv: () => requestBlob("/api/dnc/export.csv"),
  getStats: () => request("GET", "/api/stats"),
  downloadStatsCsv: () => requestBlob("/api/stats/export.csv"),

  // admin console
  getAdminOverview: () => request("GET", "/api/admin/overview"),
  setAdminBalance: (req) => request("PUT", "/api/admin/balance", req),
  resumeAi: () => request("POST", "/api/admin/resume", {}),
  getAdminErrors: () => request("GET", "/api/admin/errors"),
  getAiCalls: (limit = 50) => request("GET", `/api/admin/ai-calls?limit=${limit}`),
  getAuditSample: (n = 10) => request("GET", `/api/admin/audit/sample?n=${n}`),
  setAuditVerdict: (factId, req) =>
    request("POST", `/api/admin/audit/facts/${enc(factId)}`, req),
  getOptOuts: () => request("GET", "/api/admin/optouts"),
  createOptOut: (req) => request("POST", "/api/admin/optouts", req),
  deleteOptOut: (id) => request("DELETE", `/api/admin/optouts/${enc(id)}`),

  // public
  publicOptOut: (req) => request("POST", "/api/public/optout", req),
  getHealth: () => request("GET", "/api/health"),
}
