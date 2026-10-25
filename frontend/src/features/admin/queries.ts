import { queryOptions } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { qk } from "@/lib/api/queries"

/** Admin console data. Keys come from the shared `qk.admin` family. */

export const AUDIT_SAMPLE_SIZE = 10
export const AI_CALLS_LIMIT = 50

export const adminOverviewQuery = () =>
  queryOptions({
    queryKey: qk.admin.overview(),
    queryFn: () => api.getAdminOverview(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

export const adminErrorsQuery = () =>
  queryOptions({ queryKey: qk.admin.errors(), queryFn: () => api.getAdminErrors(), staleTime: 15_000 })

export const aiCallsQuery = (limit = AI_CALLS_LIMIT) =>
  queryOptions({ queryKey: qk.admin.aiCalls(limit), queryFn: () => api.getAiCalls(limit), staleTime: 15_000 })

/**
 * A random sample of recent leads. Never refetched on its own: a new sample
 * arriving mid-review would move the facts under the reviewer's cursor.
 */
export const auditSampleQuery = (n = AUDIT_SAMPLE_SIZE) =>
  queryOptions({
    queryKey: qk.admin.audit(n),
    queryFn: () => api.getAuditSample(n),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

export const optOutsQuery = () => queryOptions({ queryKey: qk.admin.optOuts(), queryFn: () => api.getOptOuts() })
