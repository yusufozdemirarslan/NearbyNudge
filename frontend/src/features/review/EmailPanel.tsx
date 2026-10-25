import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  PencilLineIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { AiDraftLabel } from "@/components/AiDraftLabel"
import { CalmError } from "@/components/CalmError"
import { KeyHint } from "@/components/KeyHint"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { isInProgress } from "@/components/StatusBadge"
import { api } from "@/lib/api"
import { isApiError } from "@/lib/api/client"
import type { Lead, LeadSummary, RewriteMode } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { ChangesView } from "./ChangesView"
import { BodyCounter, SubjectCounter } from "./Counters"
import { useDesk, type ChangeSnapshot } from "./desk-state"
import { EditorNotes } from "./EditorNotes"
import { EmailBody } from "./EmailBody"
import { EmailEditor } from "./EmailEditor"
import { HookMenu } from "./HookMenu"
import { writeLead } from "./lead-cache"
import { REWRITE_LABEL, useEmailActions } from "./use-email-actions"

export type EmailMode = "view" | "edit" | "changes"

export const REWRITE_KEYS: { mode: RewriteMode; label: string; key: string }[] = [
  { mode: "shorter", label: "Shorter", key: "1" },
  { mode: "friendlier", label: "Friendlier", key: "2" },
  { mode: "more_direct", label: "More direct", key: "3" },
  { mode: "another_hook", label: "Another hook", key: "4" },
]

/** Statuses whose email can still be rewritten or edited (before approval). */
export const canChangeEmail = (lead: Pick<Lead, "status" | "email"> | undefined) =>
  Boolean(lead?.email) && (lead?.status === "ready" || lead?.status === "needs_review")

/** The snapshot "Show changes" compares: from the desk, or right after a rewrite. */
export function useChangeSnapshot(lead: Lead | undefined): ChangeSnapshot | undefined {
  const desk = useDesk()
  if (!lead) return undefined
  const local = desk.snapshots[lead.id]
  if (local) return local
  if (lead.previous_email && lead.email && lead.email.origin === "rewrite") {
    return { before: lead.previous_email, after: lead.email, reverted: [] }
  }
  return undefined
}

export interface EmailPanelProps {
  summary: LeadSummary
  lead: Lead | undefined
  loadError: unknown
  onReload: () => void
  numbers: Map<string, number>
  mode: EmailMode
  onModeChange: (mode: EmailMode) => void
  draft: { subject: string; body: string } | undefined
  onDraftChange: (draft: { subject: string; body: string } | undefined) => void
  className?: string
}

/** The email column: everything about the draft except sending. */
export function EmailPanel({
  summary,
  lead,
  loadError,
  onReload,
  numbers,
  mode,
  onModeChange,
  draft,
  onDraftChange,
  className,
}: EmailPanelProps) {
  const desk = useDesk()
  const actions = useEmailActions()
  const pending = desk.pending[summary.id]
  const snapshot = useChangeSnapshot(lead)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const leadId = summary.id

  React.useEffect(() => {
    setError(null)
    setBusy(false)
  }, [leadId])

  if (!lead) {
    if (loadError) {
      const gone = isApiError(loadError) && loadError.status === 404
      return (
        <CalmError
          className={className}
          size="inline"
          title={gone ? "This business is no longer in the campaign" : "We couldn't load this lead"}
          message={gone ? "It was replaced by the next business in line, or deleted." : undefined}
          error={loadError}
          onRetry={gone ? undefined : onReload}
        />
      )
    }
    return <LoadingEmail className={className} />
  }

  if (isInProgress(lead.status)) return <ResearchProgress lead={lead} className={className} />
  if (lead.status === "failed") return <CouldntFinish lead={lead} className={className} />

  const email = lead.email
  if (!email) {
    return (
      <CalmError
        className={className}
        size="inline"
        title="No draft for this lead"
        message="Research finished without an email. Retry the research, or skip this business."
      />
    )
  }

  const changeable = canChangeEmail(lead)
  const lockedReason =
    lead.status === "approved"
      ? "Undo the approval to change this email."
      : lead.status === "sent" || lead.status === "replied"
        ? "This email was sent, so it can't be changed."
        : lead.status === "skipped" || lead.status === "dnc"
          ? "This lead is skipped. Undo the skip to change the email."
          : null

  const doRewrite = async (mode: RewriteMode, hookId?: string) => {
    setError(null)
    onModeChange("view")
    const outcome = await actions.rewrite(lead, mode, hookId)
    if (!outcome.ok && !outcome.cancelled && outcome.message) setError(`The rewrite didn't finish. ${outcome.message}`)
  }

  const withBusy = async (fn: () => Promise<{ ok: boolean; message?: string }>, prefix: string) => {
    setBusy(true)
    setError(null)
    const outcome = await fn()
    setBusy(false)
    if (!outcome.ok && outcome.message) setError(`${prefix} ${outcome.message}`)
    return outcome
  }

  return (
    <div className={cn("space-y-4", className)} data-slot="email-panel">
      {lead.status === "needs_review" && (
        <NeedsReviewBanner
          lead={lead}
          onEdit={changeable ? () => onModeChange("edit") : null}
          onAnotherHook={changeable && lead.alternatives.length > 0 ? () => void doRewrite("another_hook") : null}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <AiDraftLabel provenance={lead.provenance} editor={lead.editor} website={lead.website} />
        {lead.hook && (
          <HookMenu
            hook={lead.hook}
            alternatives={lead.alternatives}
            facts={lead.facts}
            onUse={changeable && !pending ? (id) => void doRewrite("another_hook", id) : null}
            lockedReason={pending ? "Wait for the current rewrite to finish." : lockedReason}
          />
        )}
        <VersionLine
          lead={lead}
          snapshot={snapshot}
          showingChanges={mode === "changes"}
          onToggleChanges={() => onModeChange(mode === "changes" ? "view" : "changes")}
          onUndo={
            snapshot && changeable && !pending
              ? () => {
                  onModeChange("view")
                  void withBusy(() => actions.undoRewrite(lead), "We couldn't undo the rewrite.")
                }
              : null
          }
          busy={busy}
        />
      </div>

      {pending && (
        <div role="status" className="flex items-center gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-accent px-3 py-2 text-ui">
          <Spinner className="size-4 text-primary motion-reduce:animate-none" aria-hidden="true" />
          <span>
            Rewriting: <span className="font-medium">{pending.label}</span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          {pending.controller && (
            <Button variant="link" size="xs" className="h-auto" onClick={() => actions.cancel(lead.id)}>
              Cancel
            </Button>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-warning-tint px-3 py-2 text-ui text-foreground">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{error}</span>
        </div>
      )}

      {mode === "edit" && changeable ? (
        <EmailEditor
          email={email}
          draft={draft}
          onDraftChange={onDraftChange}
          busy={busy}
          error={null}
          onCancel={() => {
            onDraftChange(undefined)
            onModeChange("view")
          }}
          onSave={(subject, body) =>
            void withBusy(() => actions.save(lead, subject, body), "We couldn't save your edits.").then((outcome) => {
              if (outcome.ok) {
                onDraftChange(undefined)
                onModeChange("view")
              }
            })
          }
        />
      ) : mode === "changes" && snapshot ? (
        <ChangesView
          snapshot={snapshot}
          busy={busy || Boolean(pending)}
          onApply={(reverted, subject, body) =>
            void withBusy(() => actions.applyReverts(lead, reverted, subject, body), "We couldn't save that change.")
          }
        />
      ) : (
        <EmailBody email={email} facts={lead.facts} numbers={numbers} className={cn(pending && "opacity-90")} />
      )}

      {mode !== "edit" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <SubjectCounter words={email.subject_word_count} />
          <BodyCounter words={email.word_count} />
        </div>
      )}

      {mode !== "edit" && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rewrite the email">
          <span className="mr-1 text-meta font-medium text-muted-foreground">Rewrite</span>
          {REWRITE_KEYS.map((item) => (
            <Button
              key={item.mode}
              variant="outline"
              size="sm"
              disabled={!changeable || Boolean(pending) || (item.mode === "another_hook" && lead.alternatives.length === 0)}
              aria-keyshortcuts={item.key}
              onClick={() => void doRewrite(item.mode)}
            >
              {item.label}
              <KeyHint keys={item.key} className="text-muted-foreground" />
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={!changeable || Boolean(pending)}
            aria-keyshortcuts="E"
            onClick={() => onModeChange("edit")}
          >
            <PencilLineIcon aria-hidden="true" />
            Edit
            <KeyHint keys="E" className="text-muted-foreground" />
          </Button>
          {lockedReason && <p className="w-full pt-1 text-meta text-muted-foreground">{lockedReason}</p>}
        </div>
      )}

      {lead.editor && <EditorNotes editor={lead.editor} />}
    </div>
  )
}

function VersionLine({
  lead,
  snapshot,
  showingChanges,
  onToggleChanges,
  onUndo,
  busy,
}: {
  lead: Lead
  snapshot: ChangeSnapshot | undefined
  showingChanges: boolean
  onToggleChanges: () => void
  onUndo: (() => void) | null
  busy: boolean
}) {
  const email = lead.email
  if (!email) return null
  if (snapshot) {
    const detail = snapshot.after.origin_detail ?? "rewritten"
    const label = detail.startsWith("another_hook")
      ? `another hook${detail.includes(":") ? ` (${detail.split(":")[1].trim()})` : ""}`
      : (REWRITE_LABEL[detail as RewriteMode] ?? detail)
    return (
      <div className="ml-auto flex flex-wrap items-center gap-1.5 text-meta text-ink-secondary">
        <span>
          Rewritten: <span className="font-medium text-foreground">{label}</span>
        </span>
        <Button variant="outline" size="xs" aria-pressed={showingChanges} onClick={onToggleChanges} disabled={busy}>
          {showingChanges ? "Hide changes" : "Show changes"}
        </Button>
        {onUndo && (
          <Button variant="ghost" size="xs" onClick={onUndo} disabled={busy}>
            Undo
          </Button>
        )}
      </div>
    )
  }
  if (email.origin === "edit")
    return <span className="ml-auto text-meta text-muted-foreground">Edited by you</span>
  if (email.origin === "restore")
    return <span className="ml-auto text-meta text-muted-foreground">Restored an earlier version</span>
  return null
}

function NeedsReviewBanner({
  lead,
  onEdit,
  onAnotherHook,
}: {
  lead: Lead
  onEdit: (() => void) | null
  onAnotherHook: (() => void) | null
}) {
  const failed = lead.editor?.checks.filter((check) => !check.passed) ?? []
  const message = lead.editor?.notes ?? lead.warnings[0] ?? "A check didn't pass. Look over the flagged sentences before approving."
  return (
    <div
      data-slot="needs-review"
      className="rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-warning-tint px-4 py-3"
    >
      <p className="flex items-center gap-2 text-ui font-semibold text-warning">
        <TriangleAlertIcon aria-hidden="true" className="size-4" />
        Needs review{failed.length > 0 ? `: ${failed.map((check) => check.label.toLowerCase()).join(", ")}` : ""}
      </p>
      <p className="mt-1 text-ui text-foreground">{message}</p>
      {(onEdit || onAnotherHook) && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {onEdit && (
            <Button size="sm" variant="outline" onClick={onEdit} aria-keyshortcuts="E">
              Edit the email
              <KeyHint keys="E" className="text-muted-foreground" />
            </Button>
          )}
          {onAnotherHook && (
            <Button size="sm" variant="outline" onClick={onAnotherHook} aria-keyshortcuts="4">
              Try another hook
              <KeyHint keys="4" className="text-muted-foreground" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

const STEPS = [
  { status: "reading", label: "Reading the business's own site" },
  { status: "choosing", label: "Choosing the hook and scoring fit" },
  { status: "writing", label: "Writing the email" },
  { status: "checking", label: "Checking facts and rules" },
] as const

function ResearchProgress({ lead, className }: { lead: Lead; className?: string }) {
  const current = STEPS.findIndex((step) => step.status === lead.status)
  return (
    <div className={cn("space-y-4", className)}>
      <div className="rounded-xl border bg-card p-5">
        <p className="text-ui font-semibold text-foreground">
          {lead.status === "queued" ? "Waiting for a research slot" : `Researching ${lead.name}`}
        </p>
        <p className="mt-1 text-ui text-ink-secondary">
          {lead.status === "queued"
            ? "It starts as soon as one of the leads ahead of it finishes. You can review other leads meanwhile."
            : "A draft usually takes about two minutes. You can review other leads meanwhile."}
        </p>
        <ol className="mt-4 space-y-2">
          {STEPS.map((step, index) => {
            const done = current > index
            const active = current === index
            return (
              <li key={step.status} className="flex items-center gap-2.5 text-ui">
                {done ? (
                  <CheckIcon aria-hidden="true" className="size-4 text-success" />
                ) : active ? (
                  <span aria-hidden="true" className="flex size-4 items-center justify-center">
                    <span className="size-2 rounded-full bg-primary" />
                  </span>
                ) : (
                  <CircleDashedIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                )}
                <span className={cn(done ? "text-ink-secondary" : active ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {step.label}
                </span>
                <span className="sr-only">{done ? "(done)" : active ? "(in progress)" : "(not started)"}</span>
              </li>
            )
          })}
        </ol>
      </div>
      <div aria-hidden="true" className="rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <PlaceholderBar width={52} height={10} />
          <PlaceholderBar width="45%" height={14} />
        </div>
        <div className="space-y-3 px-6 py-5">
          {[38, 92, 88, 64, 0, 95, 80, 0, 72, 30].map((width, i) =>
            width === 0 ? <div key={i} className="h-2" /> : <PlaceholderBar key={i} width={`${width}%`} height={12} className="block" />
          )}
        </div>
      </div>
    </div>
  )
}

function CouldntFinish({ lead, className }: { lead: Lead; className?: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = React.useState<null | "retry" | "without_site">(null)
  const [error, setError] = React.useState<string | null>(null)
  const retry = async (mode: "retry" | "without_site") => {
    setBusy(mode)
    setError(null)
    try {
      writeLead(queryClient, await api.retryLead(lead.id, { mode }))
    } catch (e) {
      setError(isApiError(e) ? e.message : "We couldn't start the retry. Please try again.")
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className={cn("rounded-xl border bg-card p-5", className)} data-slot="couldnt-finish">
      <p className="flex items-center gap-2 text-ui font-semibold text-foreground">
        <CircleAlertIcon aria-hidden="true" className="size-4 text-ink-secondary" />
        Couldn't finish: {lead.error ?? "research stopped"}
      </p>
      <p className="mt-1.5 text-ui text-ink-secondary">
        {/site/iu.test(lead.error ?? "")
          ? "The site didn't respond, blocked our reader, or had no readable text."
          : "Research stopped before a draft was ready."}{" "}
        This lead doesn't count toward your monthly leads.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-warning-tint px-3 py-2 text-ui">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void retry("retry")} disabled={busy !== null || !lead.can_retry}>
          <RotateCwIcon aria-hidden="true" />
          {busy === "retry" ? "Retrying…" : "Retry"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void retry("without_site")} disabled={busy !== null}>
          {busy === "without_site" ? "Starting…" : "Review without site facts"}
        </Button>
      </div>
      <p className="mt-2 text-meta text-muted-foreground">
        Without site facts, the draft uses only the business listing, so it will say less.
      </p>
    </div>
  )
}

function LoadingEmail({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4", className)} aria-busy="true" aria-label="Loading the lead">
      <div className="flex gap-2" aria-hidden="true">
        <PlaceholderBar width={72} height={24} />
        <PlaceholderBar width={190} height={24} />
      </div>
      <div aria-hidden="true" className="rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <PlaceholderBar width={52} height={10} />
          <PlaceholderBar width="45%" height={14} />
        </div>
        <div className="space-y-3 px-6 py-5">
          {[30, 94, 90, 60, 0, 96, 84, 0, 70].map((width, i) =>
            width === 0 ? <div key={i} className="h-2" /> : <PlaceholderBar key={i} width={`${width}%`} height={12} className="block" />
          )}
        </div>
      </div>
    </div>
  )
}
