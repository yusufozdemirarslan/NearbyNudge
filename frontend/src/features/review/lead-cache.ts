import type { QueryClient } from "@tanstack/react-query"
import { qk } from "@/lib/api/queries"
import type { Lead, LeadSummary } from "@/lib/api/types"

/** The list fields of a full lead. */
export function toSummary(lead: Lead): LeadSummary {
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

/** Adds or replaces one row in a campaign's cached lead list. */
export function upsertSummary(queryClient: QueryClient, summary: LeadSummary) {
  queryClient.setQueryData<LeadSummary[]>(qk.campaignLeads(summary.campaign_id), (list) => {
    if (!list) return list
    const index = list.findIndex((item) => item.id === summary.id)
    if (index === -1) return [...list, summary]
    const next = list.slice()
    next[index] = { ...list[index], ...summary }
    return next
  })
}

/** Removes a row (a replaced lead) from a campaign's cached lead list. */
export function removeSummary(queryClient: QueryClient, campaignId: string, leadId: string) {
  queryClient.setQueryData<LeadSummary[]>(qk.campaignLeads(campaignId), (list) =>
    list ? list.filter((item) => item.id !== leadId) : list
  )
}

/**
 * Writes a lead returned by an action into every cache that shows it: the
 * lead itself, its campaign's list, and (lazily) the Sent screen, the
 * campaigns home and the do-not-contact list (do not contact, a "No thanks"
 * reply and their undos change it).
 */
export function writeLead(queryClient: QueryClient, lead: Lead) {
  queryClient.setQueryData(qk.lead(lead.id), lead)
  upsertSummary(queryClient, toSummary(lead))
  void queryClient.invalidateQueries({ queryKey: qk.sentAll() })
  void queryClient.invalidateQueries({ queryKey: qk.campaigns(), exact: true })
  void queryClient.invalidateQueries({ queryKey: qk.stats() })
  void queryClient.invalidateQueries({ queryKey: qk.dncAll() })
}
