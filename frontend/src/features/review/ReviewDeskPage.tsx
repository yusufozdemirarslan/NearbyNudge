import * as React from "react"
import { getRouteApi, Link } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CircleMinusIcon,
  CopyIcon,
  DownloadIcon,
  MailIcon,
  MessageSquareIcon,
  PauseIcon,
  PencilLineIcon,
  SendIcon,
  SkipForwardIcon,
  Undo2Icon,
  WandIcon,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { CalmError } from "@/components/CalmError"
import { EmptyState } from "@/components/EmptyState"
import { useAccount, usePreferences, useSavePreference } from "@/hooks/use-account"
import { useAnnounce } from "@/hooks/use-announce"
import { useRegisterCommands, type Command } from "@/hooks/use-commands"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useDeskLayout } from "@/hooks/use-media-query"
import { useShortcuts, type ShortcutMap } from "@/hooks/use-shortcuts"
import { api } from "@/lib/api"
import { isApiError } from "@/lib/api/client"
import { campaignLeadsQuery, campaignQuery, leadQuery } from "@/lib/api/queries"
import type { Lead, LeadStatus, LeadSummary, ReplyOutcome } from "@/lib/api/types"
import { saveBlob, slugify, toCsv } from "@/lib/download"
import { factNumbers } from "@/lib/email"
import { plural } from "@/lib/format"
import { notify } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { ActionBar, type ActionPanel, type DeskController } from "./ActionBar"
import { DeskStateProvider, useDesk } from "./desk-state"
import { canChangeEmail, EmailPanel, REWRITE_KEYS, useChangeSnapshot, type EmailMode } from "./EmailPanel"
import { EvidencePanel } from "./EvidencePanel"
import { LeadHeader } from "./LeadHeader"
import { isActionable, isInProgress, LeadList } from "./LeadList"
import { toSummary, writeLead } from "./lead-cache"
import { inView, VIEW_LABEL, type DeskSearch, type DeskSort, type DeskView } from "./search"
import { useCampaignLive } from "./use-campaign-live"
import { useEmailActions } from "./use-email-actions"
import { useLeadActions } from "./use-lead-actions"
import { useStableOrder } from "./use-stable-order"

const route = getRouteApi("/app/campaigns/$campaignId")

/** Statuses the server won't skip: the S key, the command menu and bulk skip leave them alone. */
const UNSKIPPABLE: readonly LeadStatus[] = ["skipped", "dnc", "sent", "replied"]

/** An unsaved edit, and the email version it started from. */
interface Draft {
  subject: string
  body: string
  versionId: string | null
}

/** The review desk (brief §3.2–3.4): /campaigns/$campaignId?view=&lead=&sort= */
export function ReviewDeskPage() {
  const { campaignId } = route.useParams()
  return (
    <DeskStateProvider key={campaignId}>
      <Desk campaignId={campaignId} />
    </DeskStateProvider>
  )
}

function Desk({ campaignId }: { campaignId: string }) {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const desk = useDesk()
  const layout = useDeskLayout()
  const preferences = usePreferences()
  const savePreference = useSavePreference()
  const { data: account } = useAccount()
  const sending = account?.sending ?? null
  const livePaused = !preferences.live_updates

  // ---------------------------------------------------------------- data
  const campaignQ = useQuery({ ...campaignQuery(campaignId), refetchOnWindowFocus: !livePaused })
  const campaign = campaignQ.data
  // No live updates for a campaign that doesn't exist (the stream would retry forever).
  const missing = !campaign && isApiError(campaignQ.error) && campaignQ.error.status === 404
  const live = useCampaignLive(campaignId, livePaused, !missing)
  const running = campaign ? campaign.status === "finding" || campaign.status === "researching" : false
  const leadsQ = useQuery({
    ...campaignLeadsQuery(campaignId),
    refetchOnWindowFocus: !livePaused,
    refetchInterval: running && !live.connected && !livePaused ? 10_000 : false,
  })
  const leads = leadsQ.data

  // ---------------------------------------------------------------- URL state
  // Actions finish after a request, sometimes once the desk is gone (the user moved to
  // another screen): those late results must not navigate.
  const mounted = React.useRef(false)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const setSearch = React.useCallback(
    (patch: Partial<DeskSearch>, replace = false) => {
      if (!mounted.current) return
      void navigate({
        to: "/campaigns/$campaignId",
        params: { campaignId },
        search: (prev) => ({ ...prev, ...patch }),
        replace,
      })
    },
    [campaignId, navigate]
  )
  const defaultView = React.useMemo<DeskView>(() => {
    if (search.lead || !leads) return "all"
    if (leads.some((l) => l.status === "ready")) return "ready"
    if (leads.some((l) => l.status === "needs_review")) return "needs_review"
    return "all"
  }, [leads, search.lead])
  const view: DeskView = search.view ?? defaultView
  const sort: DeskSort = search.sort ?? "fit"
  React.useEffect(() => {
    if (!search.view && leads) setSearch({ view: defaultView }, true)
  }, [defaultView, leads, search.view, setSearch])

  const selectedId = search.lead
  const order = useStableOrder(leads, view, sort, selectedId)
  const rows = order.rows
  const rowsRef = React.useRef(rows)
  const viewRef = React.useRef(view)
  const selectedRef = React.useRef(selectedId)
  React.useLayoutEffect(() => {
    rowsRef.current = rows
    viewRef.current = view
    selectedRef.current = selectedId
  })

  const leadQ = useQuery({ ...leadQuery(selectedId ?? "none"), enabled: Boolean(selectedId) })
  const lead = selectedId && leadQ.data?.id === selectedId ? leadQ.data : undefined
  const summary: LeadSummary | undefined =
    (selectedId ? leads?.find((l) => l.id === selectedId) : undefined) ?? (lead ? toSummary(lead) : undefined)

  // Desktop: open the first lead that needs a decision when the desk opens.
  const autoSelected = React.useRef(false)
  React.useEffect(() => {
    if (autoSelected.current || !leads || !search.view) return
    autoSelected.current = true
    if (layout === "one" || selectedId) return
    const first = rows.find(isActionable)
    if (first) setSearch({ lead: first.id }, true)
  }, [layout, leads, rows, search.view, selectedId, setSearch])

  const listHadFocus = React.useRef(false)
  const select = React.useCallback(
    (id: string | undefined, options: { replace?: boolean } = {}) => {
      listHadFocus.current = Boolean(document.activeElement?.closest("[data-row-link]"))
      setSearch({ lead: id }, options.replace ?? false)
    },
    [setSearch]
  )
  React.useEffect(() => {
    if (!listHadFocus.current || !selectedId) return
    listHadFocus.current = false
    const link = document.querySelector<HTMLAnchorElement>(`[data-lead-id="${CSS.escape(selectedId)}"] [data-row-link]`)
    link?.focus()
    link?.scrollIntoView({ block: "nearest" })
  }, [selectedId])

  // Keep the selected row visible as it changes (J/K, auto-advance).
  React.useEffect(() => {
    if (!selectedId) return
    document.querySelector(`[data-lead-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [selectedId, layout])

  // Prefetch the neighbours so J/K feel instant.
  React.useEffect(() => {
    if (!selectedId) return
    const index = rows.findIndex((r) => r.id === selectedId)
    for (const neighbour of [rows[index + 1], rows[index - 1]]) {
      if (neighbour) void queryClient.prefetchQuery(leadQuery(neighbour.id))
    }
  }, [queryClient, rows, selectedId])

  const step = React.useCallback(
    (delta: 1 | -1) => {
      const list = rowsRef.current
      if (list.length === 0) return
      const index = selectedId ? list.findIndex((r) => r.id === selectedId) : -1
      const next = index === -1 ? list[delta === 1 ? 0 : list.length - 1] : list[index + delta]
      if (next) select(next.id, { replace: true })
      else announce(delta === 1 ? "That was the last lead in this view." : "This is the first lead in this view.")
    },
    [announce, select, selectedId]
  )
  const selectedIndex = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1

  /** Superhuman-style: after an action, open the next lead that still needs you. */
  const advanceFrom = React.useCallback(
    (fromId: string) => {
      // The user already moved on (J/K) while the action ran: stay where they are.
      if (selectedRef.current !== fromId) return
      const list = rowsRef.current
      const currentView = viewRef.current
      const index = list.findIndex((r) => r.id === fromId)
      const after = index >= 0 ? list.slice(index + 1) : list
      const before = index > 0 ? list.slice(0, index).reverse() : []
      const fits = (r: LeadSummary) =>
        r.id !== fromId && inView(currentView, r.status) && (currentView !== "all" || isActionable(r))
      const next = after.find(fits) ?? before.find(fits)
      if (next) select(next.id, { replace: true })
      else announce(`No more leads in ${VIEW_LABEL[currentView]}.`)
    },
    [announce, select]
  )

  // ---------------------------------------------------------------- actions
  const leadActions = useLeadActions({
    onAdvance: advanceFrom,
    onSelect: (restored) => select(restored.id, { replace: true }),
  })
  const emailActions = useEmailActions()
  const [panel, setPanel] = React.useState<ActionPanel>("none")
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [sentPrompt, setSentPrompt] = React.useState(false)
  const [mode, setMode] = React.useState<EmailMode>("view")
  // Unsaved edits, kept when the user moves to another lead and back. Each remembers the
  // email version it started from: after a rewrite or a restore it no longer applies.
  const [drafts, setDrafts] = React.useState<Readonly<Record<string, Draft>>>({})
  const awaitingReturn = React.useRef<string | null>(null)

  // Another lead: close its panels and messages, and reopen the editor if it has a draft.
  const [shownId, setShownId] = React.useState(selectedId)
  if (shownId !== selectedId) {
    setShownId(selectedId)
    setPanel("none")
    setError(null)
    setCopied(false)
    setSentPrompt(false)
    setMode(selectedId && drafts[selectedId] ? "edit" : "view")
  }

  const saveDraft = React.useCallback((leadId: string, draft: Draft | undefined) => {
    setDrafts((current) => {
      const existing = current[leadId]
      if (!draft) {
        if (!existing) return current
        const rest = { ...current }
        delete rest[leadId]
        return rest
      }
      const same =
        existing?.subject === draft.subject && existing.body === draft.body && existing.versionId === draft.versionId
      return same ? current : { ...current, [leadId]: draft }
    })
  }, [])
  /** A rewrite or a wrong-fact removal replaces the email: an open edit of the old one is dropped. */
  const dropDraft = () => {
    if (selectedId) saveDraft(selectedId, undefined)
  }
  const storedDraft = selectedId ? drafts[selectedId] : undefined
  const draft =
    storedDraft && lead?.email && storedDraft.versionId === lead.email.version_id ? storedDraft : undefined

  const changeable = canChangeEmail(lead)
  const pending = selectedId ? desk.pending[selectedId] : undefined
  const snapshot = useChangeSnapshot(lead)

  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2200)
    return () => window.clearTimeout(timer)
  }, [copied])

  // "Sent it? Mark as sent (M)" when the user comes back from their email app.
  React.useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return
      if (awaitingReturn.current && awaitingReturn.current === selectedId) {
        setSentPrompt(true)
        announce("Sent it? Press M to mark it as sent.")
      }
      awaitingReturn.current = null
    }
    document.addEventListener("visibilitychange", onReturn)
    window.addEventListener("focus", onReturn)
    return () => {
      document.removeEventListener("visibilitychange", onReturn)
      window.removeEventListener("focus", onReturn)
    }
  }, [announce, selectedId])

  // One desk action at a time. The busy state reaches the next render too late for a
  // double-click or a double key press, so a ref holds it as well.
  const busyRef = React.useRef<string | null>(null)
  const run = React.useCallback(
    async (name: string, fn: () => Promise<{ ok: boolean; message?: string }>) => {
      if (busyRef.current) return { ok: false }
      busyRef.current = name
      setBusy(name)
      setError(null)
      try {
        const outcome = await fn()
        if (!outcome.ok && outcome.message) {
          setError(outcome.message)
          announce(outcome.message)
        }
        return outcome
      } finally {
        busyRef.current = null
        setBusy(null)
      }
    },
    [announce]
  )

  const atCap = sending ? sending.sent_today >= sending.daily_cap : false
  const webmail = preferences.webmail_mode

  const controller: DeskController = {
    panel,
    setPanel: (next) => {
      setError(null)
      setPanel(next)
    },
    busy,
    error,
    rewriting: Boolean(pending),
    approve: () => {
      if (!lead || busy || !isActionable(lead) || !lead.email) return
      // A skip, do-not-contact or reply choice is open: finish or close it (Esc) first.
      if (panel !== "none" && panel !== "approve-warnings") return
      if (mode === "edit") {
        setError("Save or cancel your edits before approving.")
        announce("Save or cancel your edits before approving.")
        return
      }
      if (pending) {
        setError("Wait for the rewrite to finish before approving.")
        announce("Wait for the rewrite to finish before approving.")
        return
      }
      if (lead.warnings.length > 0 && panel !== "approve-warnings") {
        setPanel("approve-warnings")
        announce(`Before you approve: ${lead.warnings.join(" ")}`)
        return
      }
      void run("approve", () => leadActions.approve(lead)).then((o) => o.ok && setPanel("none"))
    },
    approveAnyway: () => {
      if (!lead || busy) return
      if (pending) {
        setError("Wait for the rewrite to finish before approving.")
        announce("Wait for the rewrite to finish before approving.")
        return
      }
      void run("approve", () => leadActions.approve(lead)).then((o) => o.ok && setPanel("none"))
    },
    skip: (reason) => {
      if (!summary) return
      void run("skip", () => leadActions.skip(summary, reason)).then((o) => o.ok && setPanel("none"))
    },
    doNotContact: () => {
      if (!summary) return
      void run("dnc", () => leadActions.doNotContact(summary)).then((o) => o.ok && setPanel("none"))
    },
    markSent: () => {
      if (!lead || lead.status !== "approved" || busy) return
      void run("sent", () => leadActions.markSent(lead)).then((o) => o.ok && setSentPrompt(false))
    },
    replied: (outcome: ReplyOutcome) => {
      if (!lead) return
      void run("replied", () => leadActions.replied(lead, outcome)).then((o) => o.ok && setPanel("none"))
    },
    copyEmail: () => {
      if (!lead) return
      void leadActions.copyEmail(lead).then((o) => {
        if (o.ok) setCopied(true)
        else if (o.message) setError(o.message)
      })
    },
    copyAddress: () => {
      if (!lead) return
      void leadActions.copyAddress(lead).then((o) => !o.ok && o.message && setError(o.message))
    },
    noteOpened: () => {
      if (!lead) return
      leadActions.logOpened(lead)
      awaitingReturn.current = lead.id
    },
    undoLast: () => {
      const actionId = lead?.last_action?.action_id
      if (actionId && !busy) void run("undo", () => leadActions.undo(actionId))
    },
    retryResearch: () => {
      if (!lead) return
      void run("retry", async () => {
        try {
          writeLead(queryClient, await api.retryLead(lead.id, { mode: "retry" }))
          announce("Research started again for this lead.")
          return { ok: true }
        } catch (e) {
          return { ok: false, message: isApiError(e) ? e.message : "We couldn't start the retry." }
        }
      })
    },
    copied,
    sentPrompt,
    webmail,
    toggleWebmail: () => savePreference({ webmail_mode: !webmail }),
  }

  const openEmailApp = () => {
    // Only ever hand the browser a mail link (the server builds it; this keeps it that way).
    if (!lead?.mailto_url?.startsWith("mailto:") || atCap) return
    controller.noteOpened()
    window.location.assign(lead.mailto_url)
  }

  const rewrite = (index: number) => {
    if (!lead || !changeable || pending || panel !== "none") return
    const item = REWRITE_KEYS[index]
    if (item.mode === "another_hook" && lead.alternatives.length === 0) return
    dropDraft()
    setMode("view")
    void emailActions.rewrite(lead, item.mode).then((o) => {
      if (!o.ok && !("cancelled" in o && o.cancelled) && o.message) setError(`The rewrite didn't finish. ${o.message}`)
    })
  }

  const undoLatest = () => {
    // One action at a time: an undo pressed while another action runs could undo the wrong one.
    if (busy) {
      announce("Wait for the current action to finish.")
      return
    }
    if (desk.undoStack.length > 0) void run("undo", () => leadActions.undoLatest())
    else if (lead?.last_action) controller.undoLast()
    else announce("Nothing to undo.")
  }

  const toggleChecked = () => {
    if (!selectedId) return
    const next = new Set(desk.checked)
    if (next.has(selectedId)) next.delete(selectedId)
    else next.add(selectedId)
    desk.setChecked(next)
    announce(next.has(selectedId) ? "Selected." : "Not selected.")
  }

  // ---------------------------------------------------------------- export / bulk
  // Errors from list-wide actions show in the list: no lead may be open to show them.
  const [listError, setListError] = React.useState<string | null>(null)
  const listFailed = (message: string) => {
    setListError(message)
    announce(message)
  }

  const exportAll = async () => {
    setListError(null)
    try {
      saveBlob(await api.downloadCampaignCsv(campaignId), `${slugify(campaign?.name ?? "campaign")}.csv`)
      announce("Spreadsheet downloaded.")
    } catch (e) {
      listFailed(isApiError(e) ? e.message : "We couldn't export the spreadsheet.")
    }
  }

  const exportSelected = async () => {
    const ids = rows.filter((r) => desk.checked.has(r.id)).map((r) => r.id)
    setListError(null)
    try {
      const full = await Promise.all(ids.map((id) => queryClient.fetchQuery(leadQuery(id))))
      const csv = toCsv([
        ["Business", "Status", "Fit", "Distance (mi)", "Category", "Address", "Website", "Phone", "Email", "Contact form", "Subject", "Approved", "Sent"],
        ...full.map((l) => [
          l.name,
          l.status,
          l.fit_score,
          l.distance_mi,
          l.category_label,
          l.address,
          l.website,
          l.phone,
          l.contact?.email,
          l.contact?.form_url,
          l.email?.subject,
          l.approved_at,
          l.sent_at,
        ]),
      ])
      // A byte-order mark so spreadsheet apps read accented names as UTF-8.
      saveBlob(
        new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }),
        `${slugify(campaign?.name ?? "campaign")}-selected.csv`
      )
      announce(`${plural(ids.length, "lead")} exported.`)
    } catch (e) {
      listFailed(isApiError(e) ? e.message : "We couldn't export the selected leads.")
    }
  }

  const [bulkBusy, setBulkBusy] = React.useState(false)
  const bulkSkip = async (reason: string) => {
    const chosen = rows.filter((r) => desk.checked.has(r.id))
    const targets = chosen.filter((r) => !UNSKIPPABLE.includes(r.status))
    const unskippable = chosen.length - targets.length
    setListError(null)
    if (targets.length === 0) {
      if (unskippable) listFailed("Those leads are already sent, skipped or blocked, so there's nothing to skip.")
      return
    }
    setBulkBusy(true)
    const done: { actionId: string; lead: LeadSummary }[] = []
    const failedIds: string[] = []
    for (const target of targets) {
      try {
        const result = await api.skipLead(target.id, { reason })
        writeLead(queryClient, result.lead)
        desk.pushUndo({ actionId: result.action_id, leadId: target.id, leadName: target.name, label: "Skipped" })
        done.push({ actionId: result.action_id, lead: target })
      } catch {
        failedIds.push(target.id)
      }
    }
    const failed = failedIds.length
    setBulkBusy(false)
    // The ones that failed stay selected, ready to try again.
    desk.setChecked(new Set(failedIds))
    const leftAlone = unskippable
      ? ` ${plural(unskippable, "lead")} already sent, skipped or blocked ${unskippable === 1 ? "was" : "were"} left alone.`
      : ""
    if (done.length > 0) {
      notify({
        title: `Skipped ${plural(done.length, "lead")}`,
        description: failed ? `${failed} couldn't be skipped. Try them again.` : reason,
        action: {
          label: "Undo skip",
          onClick: () => {
            void (async () => {
              for (const item of [...done].reverse()) await leadActions.undo(item.actionId)
            })()
          },
        },
      })
    }
    if (failed) listFailed(`${plural(failed, "lead")} couldn't be skipped. They're still selected: try again.${leftAlone}`)
    else if (leftAlone) listFailed(leftAlone.trim())
    if (selectedId && done.some((d) => d.lead.id === selectedId)) advanceFrom(selectedId)
  }

  // ---------------------------------------------------------------- keyboard
  const status = lead?.status ?? summary?.status
  const skippable = Boolean(status && !UNSKIPPABLE.includes(status))
  const choosing = panel !== "none" && panel !== "approve-warnings"
  const edit = () => {
    if (choosing) return
    if (changeable && !pending) setMode("edit")
    else if (lead?.status === "approved") announce("Undo the approval to change this email.")
    else if (pending) announce("Wait for the rewrite to finish before editing.")
  }
  const shortcuts: ShortcutMap = {
    j: { description: "Next lead", handler: () => step(1), repeat: true },
    k: { description: "Previous lead", handler: () => step(-1), repeat: true },
    a: { description: "Approve", handler: controller.approve },
    e: { description: "Edit the email", handler: edit },
    s: {
      description: "Skip, with a reason",
      handler: () => skippable && controller.setPanel("skip"),
    },
    "shift+d": {
      description: "Do not contact (asks first)",
      handler: () => status && status !== "dnc" && controller.setPanel("dnc"),
    },
    "1": { description: "Rewrite: shorter", handler: () => rewrite(0), display: "1–4", group: "Review desk" },
    "2": { description: "Rewrite: friendlier", handler: () => rewrite(1), hidden: true },
    "3": { description: "Rewrite: more direct", handler: () => rewrite(2), hidden: true },
    "4": { description: "Rewrite: another hook", handler: () => rewrite(3), hidden: true },
    c: {
      description: "Copy the email",
      handler: () =>
        status === "approved" || status === "sent" || status === "replied"
          ? controller.copyEmail()
          : announce("Approve the email first, then copy it."),
    },
    o: {
      description: "Open in my email app",
      handler: () => (status === "approved" ? openEmailApp() : announce("Approve the email first.")),
    },
    m: { description: "Mark as sent", handler: controller.markSent },
    r: { description: "Log a reply", handler: () => status === "sent" && controller.setPanel("replied") },
    z: { description: "Undo the latest action", handler: undoLatest },
    x: { description: "Select or unselect this lead", handler: toggleChecked },
    escape: {
      description: "Close",
      handler: () => {
        if (panel !== "none") controller.setPanel("none")
        else if (mode === "changes") setMode("view")
      },
      hidden: true,
    },
  }
  useShortcuts(shortcuts, { group: "Review desk" })

  // ---------------------------------------------------------------- commands
  const commands: Command[] = [
    { id: "next", label: "Next lead", group: "Review desk", shortcut: "J", icon: ArrowDownIcon, run: () => step(1) },
    { id: "prev", label: "Previous lead", group: "Review desk", shortcut: "K", icon: ArrowUpIcon, run: () => step(-1) },
    ...(lead && isActionable(lead)
      ? [
          { id: "approve", label: "Approve", group: "Review desk", shortcut: "A", icon: CheckIcon, run: controller.approve },
          ...(changeable && !pending
            ? [{ id: "edit", label: "Edit the email", group: "Review desk", shortcut: "E", icon: PencilLineIcon, run: edit }]
            : []),
          ...REWRITE_KEYS.map((item, index) => ({
            id: `rewrite-${item.mode}`,
            label: `Rewrite: ${item.label.toLowerCase()}`,
            group: "Review desk",
            shortcut: item.key,
            icon: WandIcon,
            run: () => rewrite(index),
          })),
        ]
      : []),
    ...(lead && lead.status === "approved"
      ? [
          { id: "open", label: "Open in my email app", group: "Review desk", shortcut: "O", icon: MailIcon, run: openEmailApp },
          { id: "copy", label: "Copy the email", group: "Review desk", shortcut: "C", icon: CopyIcon, run: controller.copyEmail },
          { id: "sent", label: "Mark as sent", group: "Review desk", shortcut: "M", icon: SendIcon, run: controller.markSent },
        ]
      : []),
    ...(lead && lead.status === "sent"
      ? [{ id: "replied", label: "Log a reply", group: "Review desk", shortcut: "R", icon: MessageSquareIcon, run: () => controller.setPanel("replied") }]
      : []),
    ...(summary && skippable
      ? [{ id: "skip", label: "Skip this lead", group: "Review desk", shortcut: "S", icon: SkipForwardIcon, run: () => controller.setPanel("skip") }]
      : []),
    ...(summary && status !== "dnc"
      ? [{ id: "dnc", label: `Never contact ${summary.name}`, group: "Review desk", shortcut: "shift+D", icon: CircleMinusIcon, run: () => controller.setPanel("dnc") }]
      : []),
    { id: "undo", label: "Undo the latest action", group: "Review desk", shortcut: "Z", icon: Undo2Icon, run: undoLatest },
    ...(running
      ? [
          {
            id: "live",
            label: livePaused ? "Resume live updates" : "Pause live updates",
            group: "Review desk",
            icon: PauseIcon,
            run: () => savePreference({ live_updates: livePaused }),
          },
        ]
      : []),
    { id: "export", label: "Export this campaign (CSV)", group: "Review desk", icon: DownloadIcon, run: () => void exportAll() },
  ]
  useRegisterCommands(commands)

  // ---------------------------------------------------------------- chrome
  useDocumentTitle(campaign?.name ?? "Review desk")


  const firstReady = React.useMemo(
    () => (leads ?? []).filter((l) => l.status === "ready").sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))[0],
    [leads]
  )
  const showReviewFirst =
    firstReady && (!summary || isInProgress(summary.status) || summary.status === "failed") ? firstReady : null
  const reviewFirst = showReviewFirst
    ? () => setSearch({ view: "ready", lead: showReviewFirst.id })
    : null

  // ---------------------------------------------------------------- render
  if (campaignQ.isError && !campaign) {
    return (
      <CalmError
        title={missing ? "We couldn't find this campaign" : "We couldn't load this campaign"}
        pageHeading
        message={missing ? "It may have been deleted." : undefined}
        error={campaignQ.error}
        onRetry={missing ? undefined : () => void campaignQ.refetch()}
        action={
          <Link to="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Go to campaigns
          </Link>
        }
      />
    )
  }

  const numbers = factNumbers(lead?.email)
  const list = (
    <LeadList
      campaignId={campaignId}
      campaign={campaign}
      leads={leads}
      loading={leadsQ.isPending}
      loadError={leads ? null : leadsQ.error}
      onRetryLoad={() => void leadsQ.refetch()}
      listError={listError}
      onDismissListError={() => setListError(null)}
      order={order}
      view={view}
      sort={sort}
      selectedId={selectedId}
      checked={desk.checked}
      onCheckedChange={desk.setChecked}
      compact={preferences.compact_rows}
      livePaused={livePaused}
      liveWaiting={live.waiting}
      onLivePausedChange={(paused) => savePreference({ live_updates: !paused })}
      onViewChange={(next) => setSearch({ view: next })}
      onSortChange={(next) => setSearch({ sort: next }, true)}
      onOpenLead={(id) => {
        listHadFocus.current = false
        if (id === selectedId) return
      }}
      onReviewFirst={reviewFirst}
      onExportAll={() => void exportAll()}
      onExportSelected={() => void exportSelected()}
      onBulkSkip={(reason) => void bulkSkip(reason)}
      bulkBusy={bulkBusy}
      orientation={layout === "one" ? "horizontal" : "vertical"}
      className={layout === "one" ? "h-full" : "min-h-0 border-r border-ink"}
    />
  )

  const detail =
    summary && selectedId ? (
      <LeadDetail
        key={selectedId}
        layout={layout}
        summary={summary}
        lead={lead}
        loadError={leadQ.error}
        onReload={() => void leadQ.refetch()}
        numbers={numbers}
        mode={mode}
        onModeChange={setMode}
        draft={draft}
        onDraftChange={(next) =>
          saveDraft(selectedId, next && { ...next, versionId: lead?.email?.version_id ?? null })
        }
        livePaused={livePaused}
        onPrev={selectedIndex > 0 ? () => step(-1) : null}
        onNext={selectedIndex >= 0 && selectedIndex < rows.length - 1 ? () => step(1) : null}
        onBack={layout === "one" ? () => setSearch({ lead: undefined }) : undefined}
        controller={controller}
        sending={sending}
        snapshotOpen={mode === "changes" && Boolean(snapshot)}
        onWrongFact={
          lead && changeable && !pending
            ? (fact, note) => {
                dropDraft()
                setMode("view")
                void emailActions.removeWrongFact(lead, fact, note).then((o) => {
                  if (!o.ok && !("cancelled" in o && o.cancelled) && o.message) setError(`We couldn't remove the fact. ${o.message}`)
                })
              }
            : null
        }
      />
    ) : selectedId && leadQ.isError ? (
      <CalmError
        size="inline"
        className="m-6"
        title="This business is no longer in the campaign"
        message="It was replaced by the next business in line, or deleted."
        action={
          <Button size="sm" variant="outline" onClick={() => setSearch({ lead: undefined })}>
            Back to the list
          </Button>
        }
      />
    ) : (
      <NoSelection running={running} reviewFirst={reviewFirst} hasLeads={(leads?.length ?? 0) > 0} />
    )

  if (layout === "one") {
    return <div className="h-full min-h-0">{selectedId ? detail : list}</div>
  }

  return (
    <div
      className={cn(
        "grid h-full min-h-0",
        layout === "three" ? "grid-cols-[24rem_minmax(0,1fr)]" : "grid-cols-[22rem_minmax(0,1fr)]"
      )}
    >
      {list}
      <div className="flex min-h-0 min-w-0 flex-col" role="region" aria-label="Selected lead">
        {detail}
      </div>
    </div>
  )
}

function NoSelection({
  running,
  reviewFirst,
  hasLeads,
}: {
  running: boolean
  reviewFirst: (() => void) | null
  hasLeads: boolean
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        title={reviewFirst ? "A draft is ready" : running ? "Drafts are on the way" : hasLeads ? "Pick a lead to review" : "No leads yet"}
        description={
          reviewFirst
            ? "Review it now while the rest are researched."
            : running
              ? "Each business is read, scored and written up in four steps. The first draft is usually ready within two minutes."
              : hasLeads
                ? "Choose a lead from the list, or press J."
                : "This campaign has no leads."
        }
        action={reviewFirst ? <Button onClick={reviewFirst}>Review first lead</Button> : undefined}
      />
    </div>
  )
}

interface LeadDetailProps {
  layout: "one" | "two" | "three"
  summary: LeadSummary
  lead: Lead | undefined
  loadError: unknown
  onReload: () => void
  numbers: Map<string, number>
  mode: EmailMode
  onModeChange: (mode: EmailMode) => void
  draft: { subject: string; body: string } | undefined
  onDraftChange: (draft: { subject: string; body: string } | undefined) => void
  livePaused: boolean
  onPrev: (() => void) | null
  onNext: (() => void) | null
  onBack?: () => void
  controller: DeskController
  sending: import("@/lib/api/types").SendingToday | null
  snapshotOpen: boolean
  onWrongFact: React.ComponentProps<typeof EvidencePanel>["onWrongFact"]
}

/**
 * Wraps the action bar and tells the toast viewport how tall it is
 * (--nn-bottom-bar), so Undo messages never cover its buttons.
 */
function BottomBar({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const update = () => root.style.setProperty("--nn-bottom-bar", `${Math.ceil(el.getBoundingClientRect().height)}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty("--nn-bottom-bar")
    }
  }, [])
  return (
    <div ref={ref} className="shrink-0">
      {children}
    </div>
  )
}

/** Header, email (+ evidence) and the action bar for the selected lead. */
function LeadDetail(props: LeadDetailProps) {
  const { layout, summary, lead } = props
  const desk = useDesk()
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    desk.setActiveFactId(null)
    // a new lead starts at the top
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.id])

  const email = (
    <EmailPanel
      summary={summary}
      lead={lead}
      loadError={props.loadError}
      onReload={props.onReload}
      numbers={props.numbers}
      mode={props.mode}
      onModeChange={props.onModeChange}
      draft={props.draft}
      onDraftChange={props.onDraftChange}
      className="min-w-0"
    />
  )
  const evidence = lead ? (
    <EvidencePanel
      lead={lead}
      numbers={props.numbers}
      aligned={layout === "three" && props.mode === "view"}
      onCopyAddress={props.controller.copyAddress}
      onWrongFact={props.onWrongFact}
    />
  ) : null

  const header = (
    <LeadHeader
      summary={summary}
      lead={lead}
      onPrev={props.onPrev}
      onNext={props.onNext}
      onBack={props.onBack}
      livePaused={props.livePaused}
    />
  )
  const bar = (
    <BottomBar>
    <ActionBar
      summary={summary}
      lead={lead}
      sending={props.sending}
      controller={props.controller}
      compact={layout === "one"}
      align={layout === "three" ? "start" : "center"}
    />
    </BottomBar>
  )

  if (layout === "one") {
    return (
      <div className="flex h-full min-h-0 flex-col" role="region" aria-label={summary.name}>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {header}
          <div className="space-y-6 px-4 py-5">
            {email}
            {evidence && (
              <Collapsible className="border-t-2 border-ink">
                <CollapsibleTrigger className="flex min-h-12 w-full items-baseline justify-between gap-3 py-3 text-left">
                  <span className="text-lead font-extrabold stretch-condensed">Evidence</span>
                  <span className="aside">
                    Contact, {plural(lead?.facts.filter((f) => f.used).length ?? 0, "fact")} used, site check
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="pb-4">{evidence}</CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>
        {bar}
      </div>
    )
  }

  return (
    <>
      {header}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-slot="desk-scroll">
        {layout === "three" ? (
          <div className="grid min-h-full grid-cols-[minmax(0,1fr)_19rem]">
            <div className="min-w-0 px-8 py-6">{email}</div>
            {evidence && <div className="border-l border-ink px-6 py-6">{evidence}</div>}
          </div>
        ) : (
          <div className="mx-auto max-w-[46rem] space-y-10 px-6 py-6">
            {email}
            {evidence}
          </div>
        )}
      </div>
      {bar}
    </>
  )
}
