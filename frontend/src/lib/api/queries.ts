import { queryOptions } from "@tanstack/react-query"
import { api } from "./index"
import type { SentFilter } from "./api"

/**
 * Query keys, one family per resource. Invalidate a whole family with its
 * prefix, e.g. `queryClient.invalidateQueries({ queryKey: qk.campaigns() })`.
 */
export const qk = {
  session: () => ["session"] as const,
  me: () => ["me"] as const,
  account: () => ["account"] as const,
  status: () => ["status"] as const,
  campaigns: () => ["campaigns"] as const,
  campaign: (id: string) => ["campaigns", id] as const,
  campaignLeads: (id: string) => ["campaigns", id, "leads"] as const,
  lastInput: () => ["last-input"] as const,
  industries: () => ["industries"] as const,
  geo: (q: string) => ["geo", q] as const,
  leads: () => ["leads"] as const,
  lead: (id: string) => ["leads", id] as const,
  sent: (status: SentFilter) => ["sent", status] as const,
  sentAll: () => ["sent"] as const,
  dnc: (q: string) => ["dnc", q] as const,
  dncAll: () => ["dnc"] as const,
  stats: () => ["stats"] as const,
  admin: {
    all: () => ["admin"] as const,
    overview: () => ["admin", "overview"] as const,
    errors: () => ["admin", "errors"] as const,
    aiCalls: (limit: number) => ["admin", "ai-calls", limit] as const,
    audit: (n: number) => ["admin", "audit", n] as const,
    optOuts: () => ["admin", "optouts"] as const,
  },
}

/** Whether this copy asks for sign-in and whether this browser is signed in. */
export const sessionQuery = () =>
  queryOptions({ queryKey: qk.session(), queryFn: () => api.getSession(), staleTime: 60_000 })

/** The workspace (`onboarded`, sender name). Used by the route guards. */
export const meQuery = () =>
  queryOptions({ queryKey: qk.me(), queryFn: () => api.getMe(), staleTime: 60_000 })

/** Account, profile, preferences, usage and today's sending meter. */
export const accountQuery = () =>
  queryOptions({ queryKey: qk.account(), queryFn: () => api.getAccount(), staleTime: 30_000 })

/** System status: AI name and the paused banner. Polled every 30 s. */
export const statusQuery = () =>
  queryOptions({
    queryKey: qk.status(),
    queryFn: () => api.getStatus(),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

export const campaignsQuery = () =>
  queryOptions({ queryKey: qk.campaigns(), queryFn: () => api.getCampaigns() })

export const campaignQuery = (id: string) =>
  queryOptions({ queryKey: qk.campaign(id), queryFn: () => api.getCampaign(id) })

export const campaignLeadsQuery = (id: string) =>
  queryOptions({ queryKey: qk.campaignLeads(id), queryFn: () => api.getCampaignLeads(id) })

export const leadQuery = (id: string) =>
  queryOptions({ queryKey: qk.lead(id), queryFn: () => api.getLead(id), staleTime: 15_000 })

export const sentQuery = (status: SentFilter) =>
  queryOptions({ queryKey: qk.sent(status), queryFn: () => api.getSent(status) })

export const statsQuery = () =>
  queryOptions({ queryKey: qk.stats(), queryFn: () => api.getStats() })

export const dncQuery = (q = "") =>
  queryOptions({ queryKey: qk.dnc(q), queryFn: () => api.getDnc(q || undefined) })

export const lastInputQuery = () =>
  queryOptions({ queryKey: qk.lastInput(), queryFn: () => api.getLastInput() })

export const industriesQuery = () =>
  queryOptions({
    queryKey: qk.industries(),
    queryFn: () => api.getIndustries(),
    staleTime: Infinity,
  })
