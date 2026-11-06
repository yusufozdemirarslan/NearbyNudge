import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { isApiError } from "@/lib/api/client"
import type { ActionResult, Lead, LeadSummary, ReplyOutcome } from "@/lib/api/types"
import { copyText } from "@/lib/clipboard"
import { notify } from "@/lib/toast"
import { setSendingInCache } from "@/hooks/use-account"
import { useAnnounce } from "@/hooks/use-announce"
import { statusText } from "@/components/StatusBadge"
import { useDeskOptional } from "./desk-state"
import { writeLead } from "./lead-cache"

type AnyLead = Pick<LeadSummary, "id" | "name" | "campaign_id">

export interface ActionOutcome {
  ok: boolean
  /** Plain sentence to show in place when ok is false. */
  message?: string
  code?: string
  /** A repeat (double-click, double key press) of an action still running: nothing was sent. */
  ignored?: boolean
}

const IGNORED: ActionOutcome = { ok: false, ignored: true }

const failure = (error: unknown): ActionOutcome => ({
  ok: false,
  message: isApiError(error) ? error.message : "Something went wrong. Please try again.",
  code: isApiError(error) ? error.code : undefined,
})

const REPLY_LABEL: Record<ReplyOutcome, string> = {
  interested: "Interested",
  no_thanks: "No thanks",
  other: "Other reply",
}

export interface LeadActionOptions {
  /** Called after skip, do-not-contact and mark-as-sent so the next lead opens. */
  onAdvance?: (fromLeadId: string) => void
  /** Called after an undo so the restored lead is shown. */
  onSelect?: (lead: Lead) => void
}

/**
 * Lead actions with their cache updates, Undo messages (≥ 12 s, paused on
 * hover/focus) and announcements. Errors come back as `{ ok: false, message }`
 * for the caller to show in place; nothing fails silently.
 */
export function useLeadActions(options: LeadActionOptions = {}) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const desk = useDeskOptional()
  const optionsRef = React.useRef(options)
  React.useLayoutEffect(() => {
    optionsRef.current = options
  })
  // Results that arrive after the screen closed (an Undo pressed in a toast on another
  // screen, a slow request) don't move a screen that's gone.
  React.useEffect(
    () => () => {
      optionsRef.current = {}
    },
    []
  )
  const undoing = React.useRef(new Set<string>())
  // One action per lead at a time: a second click or key press while the first is on its
  // way would be refused by the server and show a false error.
  const acting = React.useRef(new Set<string>())
  const once = React.useCallback(async (leadId: string, fn: () => Promise<ActionOutcome>): Promise<ActionOutcome> => {
    if (acting.current.has(leadId)) return IGNORED
    acting.current.add(leadId)
    try {
      return await fn()
    } finally {
      acting.current.delete(leadId)
    }
  }, [])

  const undo = React.useCallback(
    async (actionId: string): Promise<ActionOutcome> => {
      // The same undo twice (a double press) would fail the second time: send it once.
      if (undoing.current.has(actionId)) return IGNORED
      undoing.current.add(actionId)
      try {
        const result = await api.undoAction(actionId)
        writeLead(queryClient, result.lead)
        setSendingInCache(queryClient, result.sending)
        desk?.dropUndo(actionId)
        const now = statusText({
          status: result.lead.status,
          stageLabel: result.lead.stage_label,
          date: result.lead.sent_at,
          reason: result.lead.skip_reason,
          replyOutcome: result.lead.reply_outcome,
        })
        notify({ title: "Undone", description: `${result.lead.name} is back to ${now}.` })
        optionsRef.current.onSelect?.(result.lead)
        return { ok: true }
      } catch (error) {
        // Gone or already undone (another tab, a newer action): it can never be undone from here.
        if (isApiError(error) && (error.status === 404 || error.status === 409)) desk?.dropUndo(actionId)
        const outcome = failure(error)
        notify({ title: "Couldn't undo", description: outcome.message, type: "warning" })
        announce(`Couldn't undo. ${outcome.message}`)
        return outcome
      } finally {
        undoing.current.delete(actionId)
      }
    },
    [announce, desk, queryClient]
  )

  /** Shared bookkeeping after an action that returns ActionResult. */
  const after = React.useCallback(
    (lead: AnyLead, result: ActionResult, label: string, description: string, undoLabel: string) => {
      writeLead(queryClient, result.lead)
      setSendingInCache(queryClient, result.sending)
      desk?.pushUndo({ actionId: result.action_id, leadId: lead.id, leadName: lead.name, label })
      notify({
        title: label,
        description,
        // The same name as the undo button on the desk (one name per action).
        action: { label: undoLabel, onClick: () => void undo(result.action_id) },
      })
    },
    [desk, queryClient, undo]
  )

  const approve = React.useCallback(
    (lead: AnyLead): Promise<ActionOutcome> =>
      once(lead.id, async () => {
        try {
          const result = await api.approveLead(lead.id)
          after(lead, result, "Approved", `${lead.name}. Send it from your own email account.`, "Undo approval")
          return { ok: true }
        } catch (error) {
          return failure(error)
        }
      }),
    [after, once]
  )

  const skip = React.useCallback(
    (lead: AnyLead, reason: string, advance = true): Promise<ActionOutcome> =>
      once(lead.id, async () => {
        try {
          const result = await api.skipLead(lead.id, { reason })
          after(lead, result, "Skipped", `${lead.name}: ${reason}`, "Undo skip")
          if (advance) optionsRef.current.onAdvance?.(lead.id)
          return { ok: true }
        } catch (error) {
          return failure(error)
        }
      }),
    [after, once]
  )

  const doNotContact = React.useCallback(
    (lead: AnyLead, reason?: string): Promise<ActionOutcome> =>
      once(lead.id, async () => {
        try {
          const result = await api.dncLead(lead.id, reason ? { reason } : {})
          after(lead, result, "Won't contact again", `${lead.name} is on your do-not-contact list.`, "Undo do not contact")
          optionsRef.current.onAdvance?.(lead.id)
          return { ok: true }
        } catch (error) {
          return failure(error)
        }
      }),
    [after, once]
  )

  const markSent = React.useCallback(
    (lead: AnyLead, advance = true): Promise<ActionOutcome> =>
      once(lead.id, async () => {
        try {
          const result = await api.markSent(lead.id)
          after(lead, result, "Marked as sent", `${lead.name}. Sent today: ${result.sending.sent_today} of ${result.sending.daily_cap}.`, "Undo mark as sent")
          if (advance) optionsRef.current.onAdvance?.(lead.id)
          return { ok: true }
        } catch (error) {
          if (isApiError(error, "daily_cap_reached")) {
            void queryClient.invalidateQueries({ queryKey: ["account"] })
          }
          return failure(error)
        }
      }),
    [after, once, queryClient]
  )

  const replied = React.useCallback(
    (lead: AnyLead, outcome: ReplyOutcome): Promise<ActionOutcome> =>
      once(lead.id, async () => {
        try {
          const result = await api.markReplied(lead.id, { outcome })
          const extra = outcome === "no_thanks" ? " Added to your do-not-contact list." : ""
          after(lead, result, "Reply logged", `${lead.name}: ${REPLY_LABEL[outcome]}.${extra}`, "Undo reply")
          return { ok: true }
        } catch (error) {
          return failure(error)
        }
      }),
    [after, once]
  )

  /** Undo the newest action in this session (Z). */
  const undoLatest = React.useCallback(async (): Promise<ActionOutcome> => {
    const latest = desk?.undoStack[desk.undoStack.length - 1]
    if (!latest) {
      announce("Nothing to undo.")
      return { ok: false, message: "Nothing to undo." }
    }
    return undo(latest.actionId)
  }, [announce, desk, undo])

  const copyEmail = React.useCallback(
    async (lead: Lead): Promise<ActionOutcome> => {
      if (!lead.copy_text) return { ok: false, message: "This lead has no email to copy yet." }
      const ok = await copyText(lead.copy_text)
      if (!ok) return { ok: false, message: "Your browser blocked copying. Select the email text and copy it yourself." }
      void api.logLeadEvent(lead.id, { kind: "copied" }).catch(() => undefined)
      announce("Copied. Paste it into a new email.")
      return { ok: true }
    },
    [announce]
  )

  const copyAddress = React.useCallback(
    async (lead: Lead): Promise<ActionOutcome> => {
      const address = lead.contact?.email
      if (!address) return { ok: false, message: "There is no published email address to copy." }
      const ok = await copyText(address)
      if (!ok) return { ok: false, message: "Your browser blocked copying." }
      void api.logLeadEvent(lead.id, { kind: "copied_address" }).catch(() => undefined)
      announce("Address copied.")
      return { ok: true }
    },
    [announce]
  )

  const logOpened = React.useCallback((lead: Pick<Lead, "id">) => {
    void api.logLeadEvent(lead.id, { kind: "opened_mailto" }).catch(() => undefined)
  }, [])

  return { approve, skip, doNotContact, markSent, replied, undo, undoLatest, copyEmail, copyAddress, logOpened }
}
