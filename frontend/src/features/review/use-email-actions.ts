import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { isAbortError, isApiError } from "@/lib/api/client"
import { qk } from "@/lib/api/queries"
import type { Fact, Lead, RewriteMode } from "@/lib/api/types"
import { composeBody } from "@/lib/email"
import { useAnnounce } from "@/hooks/use-announce"
import { useDesk, type ChangeSnapshot } from "./desk-state"
import { writeLead } from "./lead-cache"
import type { ActionOutcome } from "./use-lead-actions"

export const REWRITE_LABEL: Record<RewriteMode, string> = {
  shorter: "shorter",
  friendlier: "friendlier",
  more_direct: "more direct",
  another_hook: "another hook",
}

const failure = (error: unknown): ActionOutcome => ({
  ok: false,
  message: isApiError(error) ? error.message : "Something went wrong. Please try again.",
  code: isApiError(error) ? error.code : undefined,
})

/**
 * Changes to a lead's email: rewrites (cancellable), wrong-fact removal,
 * edits, reverting changes from "Show changes", and undoing a rewrite.
 * Pending rewrites live in the desk store, so they survive moving between
 * leads; the current text stays readable meanwhile.
 */
export function useEmailActions() {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const desk = useDesk()

  const run = React.useCallback(
    async (lead: Lead, label: string, call: (signal: AbortSignal) => Promise<Lead>): Promise<ActionOutcome & { cancelled?: boolean }> => {
      if (desk.pending[lead.id]) return { ok: false, message: "A rewrite is already running." }
      const controller = new AbortController()
      desk.setPending(lead.id, { label, controller })
      announce(`Rewriting: ${label}.`)
      try {
        const next = await call(controller.signal)
        writeLead(queryClient, next)
        if (next.previous_email && next.email) {
          desk.setSnapshot(lead.id, { before: next.previous_email, after: next.email, reverted: [] })
        }
        announce("Rewrite finished. Use Show changes to compare, or Undo.")
        return { ok: true }
      } catch (error) {
        if (isAbortError(error)) {
          // The server may still finish; show whatever it has now.
          await queryClient.invalidateQueries({ queryKey: qk.lead(lead.id), exact: true })
          announce("Rewrite cancelled.")
          return { ok: false, cancelled: true }
        }
        return failure(error)
      } finally {
        desk.setPending(lead.id, null)
      }
    },
    [announce, desk, queryClient]
  )

  const rewrite = React.useCallback(
    (lead: Lead, mode: RewriteMode, hookId?: string) => {
      const hookTitle =
        mode === "another_hook"
          ? (lead.alternatives.find((h) => h.id === hookId) ?? lead.alternatives[0])?.title
          : undefined
      const label = hookTitle ? `another hook (${hookTitle})` : REWRITE_LABEL[mode]
      return run(lead, label, (signal) =>
        api.rewriteLead(lead.id, hookId ? { mode, hook_id: hookId } : { mode }, signal)
      )
    },
    [run]
  )

  const removeWrongFact = React.useCallback(
    (lead: Lead, fact: Fact, note?: string) =>
      run(lead, "removing a wrong fact", (signal) =>
        api.flagWrongFact(fact.id, note ? { note } : {}, signal)
      ),
    [run]
  )

  const cancel = React.useCallback(
    (leadId: string) => {
      desk.pending[leadId]?.controller?.abort()
    },
    [desk.pending]
  )

  const save = React.useCallback(
    async (lead: Lead, subject: string, body: string): Promise<ActionOutcome> => {
      try {
        const next = await api.updateEmail(lead.id, { subject, body })
        writeLead(queryClient, next)
        desk.setSnapshot(lead.id, null)
        announce("Saved. Sentences you changed will show Check until they're confirmed.")
        return { ok: true }
      } catch (error) {
        return failure(error)
      }
    },
    [announce, desk, queryClient]
  )

  /** Saves the email with some rewrite changes reverted, keeping the comparison open. */
  const applyReverts = React.useCallback(
    async (lead: Lead, shown: ChangeSnapshot, reverted: string[], subject: string, body: string): Promise<ActionOutcome> => {
      try {
        const next = await api.updateEmail(lead.id, { subject, body })
        writeLead(queryClient, next)
        // Keep the comparison the user is looking at: after a reload it came from the lead's
        // previous version, which this save replaces.
        desk.setSnapshot(lead.id, { ...shown, reverted })
        announce(reverted.length === 0 ? "All new words kept." : `${reverted.length} ${reverted.length === 1 ? "change" : "changes"} reverted and saved.`)
        return { ok: true }
      } catch (error) {
        return failure(error)
      }
    },
    [announce, desk, queryClient]
  )

  /** Undo a rewrite: restore the version from before it. */
  const undoRewrite = React.useCallback(
    async (lead: Lead): Promise<ActionOutcome> => {
      const before = desk.snapshots[lead.id]?.before ?? lead.previous_email
      if (!before) return { ok: false, message: "There is no earlier version to go back to." }
      try {
        let next: Lead
        try {
          next = await api.restoreVersion(lead.id, before.version_id)
        } catch (error) {
          // Only the newest versions are kept and each change saved in Show changes is one, so the
          // version from before the rewrite can be gone: put its words back instead.
          if (!isApiError(error, "not_found")) throw error
          next = await api.updateEmail(lead.id, { subject: before.subject, body: composeBody(before) })
        }
        writeLead(queryClient, next)
        desk.setSnapshot(lead.id, null)
        announce("Restored the version from before the rewrite.")
        return { ok: true }
      } catch (error) {
        return failure(error)
      }
    },
    [announce, desk, queryClient]
  )

  return { rewrite, removeWrongFact, cancel, save, applyReverts, undoRewrite }
}
