import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { qk } from "@/lib/api/queries"
import type { Campaign, CampaignSummary, Lead, LeadSummary } from "@/lib/api/types"
import { useAnnounce } from "@/hooks/use-announce"
import { isInProgress } from "@/components/StatusBadge"
import { plural } from "@/lib/format"
import { removeSummary, upsertSummary } from "./lead-cache"

/** SSE `lead` events for replaced leads carry `replaced: true` (not in api-types.ts). */
type LiveLead = LeadSummary & { replaced?: boolean }

const SUMMARY_EVERY_MS = 15_000

/**
 * Subscribes to the campaign's live events and merges them into the query
 * cache. While `paused` (Preferences.live_updates = false, WCAG 2.2.2) events
 * are held back and applied on resume. Screen readers hear at most one short
 * summary every 15 seconds ("3 more leads ready"). With `enabled` false (the campaign
 * doesn't exist) nothing connects.
 */
export function useCampaignLive(campaignId: string, paused: boolean, enabled = true) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const pausedRef = React.useRef(paused)
  const heldLeads = React.useRef(new Map<string, LiveLead>())
  const heldCampaign = React.useRef<CampaignSummary | null>(null)
  const newlyReady = React.useRef(0)
  const newlyReview = React.useRef(0)
  const [waiting, setWaiting] = React.useState(0)
  const [connected, setConnected] = React.useState(true)

  const applyLead = React.useCallback(
    (summary: LiveLead) => {
      if (summary.replaced) {
        removeSummary(queryClient, campaignId, summary.id)
        queryClient.removeQueries({ queryKey: qk.lead(summary.id), exact: true })
        return
      }
      const list = queryClient.getQueryData<LeadSummary[]>(qk.campaignLeads(campaignId))
      const previous = list?.find((item) => item.id === summary.id)
      const wasWorking = !previous || isInProgress(previous.status)
      if (wasWorking && summary.status === "ready") newlyReady.current += 1
      if (wasWorking && summary.status === "needs_review") newlyReview.current += 1
      const { replaced: _replaced, ...clean } = summary
      void _replaced
      upsertSummary(queryClient, clean)
      const cached = queryClient.getQueryData<Lead>(qk.lead(summary.id))
      if (cached && cached.updated_at !== summary.updated_at) {
        void queryClient.invalidateQueries({ queryKey: qk.lead(summary.id), exact: true })
      }
    },
    [campaignId, queryClient]
  )

  const applyCampaign = React.useCallback(
    (summary: CampaignSummary) => {
      const previous = queryClient.getQueryData<Campaign>(qk.campaign(campaignId))
      queryClient.setQueryData<Campaign>(qk.campaign(campaignId), (old) => (old ? { ...old, ...summary } : old))
      if (!previous) return
      const statusChanged = previous.status !== summary.status
      const replacedChanged = previous.counts.replaced !== summary.counts.replaced
      if (statusChanged || replacedChanged) {
        // Notices and the finish summary only come with the full campaign.
        void queryClient.invalidateQueries({ queryKey: qk.campaign(campaignId), exact: true })
      }
      if (replacedChanged) void queryClient.invalidateQueries({ queryKey: qk.campaignLeads(campaignId), exact: true })
      if (statusChanged && summary.status === "done") {
        const c = summary.counts
        const finished = c.ready + c.needs_review + c.approved + c.sent + c.skipped + c.dnc
        announce(
          `Research finished. ${plural(finished, "lead")} drafted${c.failed ? `, ${c.failed} couldn't finish` : ""}.`
        )
        newlyReady.current = 0
        newlyReview.current = 0
      }
      void queryClient.invalidateQueries({ queryKey: qk.campaigns(), exact: true })
    },
    [announce, campaignId, queryClient]
  )

  const flush = React.useCallback(() => {
    for (const summary of heldLeads.current.values()) applyLead(summary)
    heldLeads.current.clear()
    if (heldCampaign.current) applyCampaign(heldCampaign.current)
    heldCampaign.current = null
    setWaiting(0)
    // Catch up on anything the held events don't cover.
    void queryClient.invalidateQueries({ queryKey: qk.campaignLeads(campaignId), exact: true })
    void queryClient.invalidateQueries({ queryKey: qk.campaign(campaignId), exact: true })
  }, [applyCampaign, applyLead, campaignId, queryClient])

  React.useEffect(() => {
    if (!enabled) return
    const unsubscribe = api.subscribeCampaign(campaignId, {
      onLead: (summary) => {
        if (pausedRef.current) {
          heldLeads.current.set(summary.id, summary)
          setWaiting(heldLeads.current.size)
        } else applyLead(summary)
      },
      onCampaign: (summary) => {
        if (pausedRef.current) heldCampaign.current = summary
        else applyCampaign(summary)
      },
      onOpen: () => {
        setConnected(true)
        // Every open, the first included: a change made just before the stream connected
        // isn't sent on it, so the list is read again.
        if (!pausedRef.current) {
          void queryClient.invalidateQueries({ queryKey: qk.campaignLeads(campaignId), exact: true })
          void queryClient.invalidateQueries({ queryKey: qk.campaign(campaignId), exact: true })
        }
      },
      onError: () => setConnected(false),
    })
    return unsubscribe
  }, [applyCampaign, applyLead, campaignId, enabled, queryClient])

  React.useEffect(() => {
    const was = pausedRef.current
    pausedRef.current = paused
    if (was && !paused) flush()
  }, [flush, paused])

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (pausedRef.current) return
      const ready = newlyReady.current
      const review = newlyReview.current
      if (ready + review === 0) return
      const parts: string[] = []
      if (ready) parts.push(`${plural(ready, "more lead")} ready`)
      if (review) parts.push(`${review} ${review === 1 ? "needs" : "need"} review`)
      announce(parts.join(", ") + ".")
      newlyReady.current = 0
      newlyReview.current = 0
    }, SUMMARY_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [announce])

  return { waiting, connected }
}
