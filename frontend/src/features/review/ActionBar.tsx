import * as React from "react"
import { Link } from "@tanstack/react-router"
import {
  CheckIcon,
  ChevronDownIcon,
  CircleMinusIcon,
  CopyIcon,
  ExternalLinkIcon,
  LockIcon,
  MailIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  RotateCwIcon,
  SendIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmailAddress } from "@/components/EmailAddress"
import { KeyHint, keyLabel } from "@/components/KeyHint"
import { Meter } from "@/components/Meter"
import { SourceTag } from "@/components/SourceTag"
import { isInProgress } from "@/components/StatusBadge"
import { useShortcuts } from "@/hooks/use-shortcuts"
import type { Lead, LeadSummary, ReplyOutcome, SendingToday } from "@/lib/api/types"
import { formatDate, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { SkipReasons } from "./SkipReasons"

/** Which in-place panel the action bar shows. */
export type ActionPanel = "none" | "approve-warnings" | "skip" | "dnc" | "replied"

/** Everything the bar can do; the desk page owns it so shortcuts share it. */
export interface DeskController {
  panel: ActionPanel
  setPanel: (panel: ActionPanel) => void
  /** Name of the running action ("approve", "sent"…), or null. */
  busy: string | null
  /** Plain sentence shown in place when an action failed. */
  error: string | null
  approve: () => void
  approveAnyway: () => void
  skip: (reason: string) => void
  doNotContact: () => void
  markSent: () => void
  replied: (outcome: ReplyOutcome) => void
  copyEmail: () => void
  copyAddress: () => void
  /** Logs the open and starts watching for the user to come back. */
  noteOpened: () => void
  undoLast: () => void
  retryResearch: () => void
  /** True for ~2 s after a copy. */
  copied: boolean
  /** The user came back from their email app: ask "Sent it?". */
  sentPrompt: boolean
  webmail: boolean
  toggleWebmail: () => void
}

const LAST_ACTION_LABEL: Record<string, string> = {
  approve: "Undo approval",
  skip: "Undo skip",
  dnc: "Undo do not contact",
  sent: "Undo mark as sent",
  replied: "Undo reply",
}

export interface ActionBarProps {
  summary: LeadSummary
  lead: Lead | undefined
  sending: SendingToday | null
  controller: DeskController
  /** Phone layout: a compact sticky bar with large targets. */
  compact: boolean
  /** Line the bar up with the email column: "start" (three columns) or "center". */
  align?: "start" | "center"
  className?: string
}

/**
 * The bottom of the email column: Approve / Skip / More for drafts, the
 * sending preview once approved (brief §3.4), reply logging once sent, and
 * Undo from the lead's last action. Every confirmation happens in place.
 */
export function ActionBar({ summary, lead, sending, controller, compact, align = "center", className }: ActionBarProps) {
  const status = lead?.status ?? summary.status
  const c = controller
  const large = compact ? "lg" : "default"
  const lastAction = lead?.last_action
  const undoButton = lastAction ? (
    <Button variant="ghost" size={compact ? "lg" : "sm"} onClick={c.undoLast} disabled={c.busy !== null}>
      <Undo2Icon aria-hidden="true" />
      {LAST_ACTION_LABEL[lastAction.action] ?? "Undo"}
    </Button>
  ) : null

  let body: React.ReactNode
  if (c.panel === "skip") {
    body = (
      <SkipReasons
        title={`Skip ${summary.name}: why?`}
        busy={c.busy !== null}
        onChoose={c.skip}
        onCancel={() => c.setPanel("none")}
      />
    )
  } else if (c.panel === "dnc") {
    body = <DncConfirm name={summary.name} busy={c.busy === "dnc"} onConfirm={c.doNotContact} onCancel={() => c.setPanel("none")} />
  } else if (c.panel === "replied") {
    body = <ReplyChooser busy={c.busy === "replied"} onChoose={c.replied} onCancel={() => c.setPanel("none")} />
  } else if (status === "approved" && lead) {
    body = <SendingPreview lead={lead} sending={sending} controller={c} compact={compact} />
  } else if (status === "ready" || status === "needs_review") {
    body = (
      <div className="space-y-3">
        {c.panel === "approve-warnings" && lead && (
          <ApproveWarnings warnings={lead.warnings} busy={c.busy === "approve"} onApprove={c.approveAnyway} onCancel={() => c.setPanel("none")} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size={large}
            onClick={c.approve}
            disabled={c.busy !== null || !lead?.email}
            aria-keyshortcuts="A"
            className={cn(compact && "flex-1")}
          >
            <CheckIcon aria-hidden="true" />
            {c.busy === "approve" ? "Approving…" : "Approve"}
            {!compact && <KeyHint keys="A" />}
          </Button>
          <Button
            size={large}
            variant="outline"
            onClick={() => c.setPanel("skip")}
            disabled={c.busy !== null}
            aria-keyshortcuts="S"
            className={cn(compact && "flex-1")}
          >
            Skip
            {!compact && <KeyHint keys="S" className="text-muted-foreground" />}
          </Button>
          <MoreMenu lead={lead} controller={c} compact={compact} />
          {!compact && (
            <p className="ml-auto hidden text-meta text-muted-foreground xl:block">
              Approving opens the sending preview. Nothing is sent for you.
            </p>
          )}
        </div>
      </div>
    )
  } else if (status === "sent" || status === "replied") {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto flex items-center gap-2 text-ui text-foreground">
          {status === "sent" ? (
            <SendIcon aria-hidden="true" className="size-4 text-foreground" />
          ) : (
            <MessageSquareIcon aria-hidden="true" className="size-4 text-info" />
          )}
          {status === "sent"
            ? `Sent ${lead?.sent_at ? formatDate(lead.sent_at) : ""}. Did they reply?`
            : `Replied: ${lead?.reply_outcome === "interested" ? "Interested" : lead?.reply_outcome === "no_thanks" ? "No thanks (now on do not contact)" : "Other reply"}`}
        </p>
        {status === "sent" && (
          <Button size={large} variant="outline" onClick={() => c.setPanel("replied")} disabled={c.busy !== null} aria-keyshortcuts="R">
            <MessageSquareIcon aria-hidden="true" />
            Log a reply
            {!compact && <KeyHint keys="R" className="text-muted-foreground" />}
          </Button>
        )}
        <Button size={large} variant="ghost" onClick={c.copyEmail} disabled={!lead?.copy_text} aria-keyshortcuts="C">
          {c.copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {c.copied ? "Copied" : "Copy email"}
        </Button>
        {undoButton}
      </div>
    )
  } else if (status === "skipped" || status === "dnc") {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-ui text-ink-secondary">
          {status === "skipped"
            ? `Skipped${lead?.skip_reason ? `: ${lead.skip_reason}` : ""}. It won't be sent.`
            : "On your do-not-contact list. It won't be drafted again."}
        </p>
        {undoButton}
      </div>
    )
  } else {
    // In progress or couldn't finish: only skipping or blocking makes sense.
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-ui text-ink-secondary">
          {isInProgress(status) ? "Still being researched. You can skip it now if you know it isn't a fit." : "Retry the research above, or skip this business."}
        </p>
        <Button size={large} variant="outline" onClick={() => c.setPanel("skip")} disabled={c.busy !== null} aria-keyshortcuts="S">
          Skip
          {!compact && <KeyHint keys="S" className="text-muted-foreground" />}
        </Button>
        <MoreMenu lead={lead} controller={c} compact={compact} />
      </div>
    )
  }

  return (
    <div
      data-slot="action-bar"
      className={cn(
        "border-t bg-card",
        compact ? "px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "px-4 py-3 sm:px-6",
        className
      )}
    >
      <div className={cn("w-full space-y-2.5", align === "center" ? "mx-auto max-w-[46rem]" : "max-w-[48rem]")}>
        {c.error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-warning-tint px-3 py-2 text-ui text-foreground">
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            {c.error}
          </p>
        )}
        {body}
      </div>
    </div>
  )
}

function MoreMenu({ lead, controller, compact }: { lead: Lead | undefined; controller: DeskController; compact: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? "lg" : "default"}
            aria-label="More actions"
            className={cn(compact && "flex-1")}
          />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" />
        More
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuItem variant="destructive" onClick={() => controller.setPanel("dnc")}>
          <CircleMinusIcon aria-hidden="true" />
          Do not contact…
          <DropdownMenuShortcut>{keyLabel("shift+D")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {lead?.contact?.email && (
          <DropdownMenuItem onClick={controller.copyAddress}>
            <CopyIcon aria-hidden="true" />
            Copy address
          </DropdownMenuItem>
        )}
        {lead && (lead.status === "needs_review" || lead.status === "failed") && (
          <DropdownMenuItem onClick={controller.retryResearch}>
            <RotateCwIcon aria-hidden="true" />
            Retry research
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ApproveWarnings({
  warnings,
  busy,
  onApprove,
  onCancel,
}: {
  warnings: string[]
  busy: boolean
  onApprove: () => void
  onCancel: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  React.useEffect(() => ref.current?.focus(), [])
  useShortcuts({ escape: { description: "Back to the email", handler: onCancel, group: "Approving" } }, { group: "Approving" })
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-labelledby={titleId}
      data-slot="approve-warnings"
      className="rounded-lg border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-warning-tint px-3 py-2.5"
    >
      <p id={titleId} className="flex items-center gap-2 text-ui font-semibold text-warning">
        <TriangleAlertIcon aria-hidden="true" className="size-4" />
        Before you approve
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-6 text-ui text-foreground">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button size="sm" onClick={onApprove} disabled={busy}>
          {busy ? "Approving…" : "Approve anyway"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Review the email
        </Button>
      </div>
    </div>
  )
}

function DncConfirm({ name, busy, onConfirm, onCancel }: { name: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const titleId = React.useId()
  React.useEffect(() => buttonRef.current?.focus(), [])
  useShortcuts({ escape: { description: "Cancel", handler: onCancel, group: "Do not contact" } }, { group: "Do not contact" })
  return (
    <div role="group" aria-labelledby={titleId} data-slot="dnc-confirm" className="space-y-2.5">
      <div>
        <p id={titleId} className="text-ui font-semibold text-foreground">
          Never contact {name}?
        </p>
        <p className="text-ui text-ink-secondary">
          They go on your do-not-contact list and won't be drafted in any campaign. You can remove them later from{" "}
          <Link to="/dnc" className="font-medium text-primary hover:underline">
            Do not contact
          </Link>
          .
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button ref={buttonRef} variant="destructive" onClick={onConfirm} disabled={busy}>
          <CircleMinusIcon aria-hidden="true" />
          {busy ? "Adding…" : `Never contact ${name}`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function ReplyChooser({ busy, onChoose, onCancel }: { busy: boolean; onChoose: (outcome: ReplyOutcome) => void; onCancel: () => void }) {
  const firstRef = React.useRef<HTMLButtonElement>(null)
  const titleId = React.useId()
  React.useEffect(() => firstRef.current?.focus(), [])
  useShortcuts(
    {
      "1": { description: "Reply: Interested", handler: () => onChoose("interested"), group: "Replies" },
      "2": { description: "Reply: No thanks (adds do not contact)", handler: () => onChoose("no_thanks"), group: "Replies" },
      "3": { description: "Reply: Other", handler: () => onChoose("other"), group: "Replies" },
      escape: { description: "Cancel", handler: onCancel, group: "Replies" },
    },
    { enabled: !busy, group: "Replies" }
  )
  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-wrap items-center gap-1.5" data-slot="reply-chooser">
      <span id={titleId} className="mr-1 text-ui font-medium text-foreground">
        How did they reply?
      </span>
      <Button ref={firstRef} size="sm" variant="outline" onClick={() => onChoose("interested")} disabled={busy} aria-keyshortcuts="1">
        <KeyHint keys="1" />
        Interested
      </Button>
      <Button size="sm" variant="outline" onClick={() => onChoose("no_thanks")} disabled={busy} aria-keyshortcuts="2">
        <KeyHint keys="2" />
        No thanks
      </Button>
      <Button size="sm" variant="outline" onClick={() => onChoose("other")} disabled={busy} aria-keyshortcuts="3">
        <KeyHint keys="3" />
        Other
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <p className="w-full text-meta text-muted-foreground">"No thanks" also adds them to your do-not-contact list.</p>
    </div>
  )
}

/**
 * The sending preview (brief §3.4): after approval the bar explains that
 * NearbyNudge doesn't send, shows who it goes to and from which source, and
 * offers Open in my email app (O), Copy email (C) and Mark as sent (M), with
 * today's meter. Webmail users get Copy as the main button. At the daily cap
 * the buttons lock and say when they unlock.
 */
function SendingPreview({
  lead,
  sending,
  controller: c,
  compact,
}: {
  lead: Lead
  sending: SendingToday | null
  controller: DeskController
  compact: boolean
}) {
  const contact = lead.contact
  const atCap = sending ? sending.sent_today >= sending.daily_cap : false
  const size = compact ? "lg" : "default"
  const formOnly = contact?.kind === "form" && contact.form_url
  const noContact = !contact || contact.kind === "none"

  const openLabel = (
    <>
      <MailIcon aria-hidden="true" />
      Open in my email app
      {!compact && <KeyHint keys="O" className={c.webmail ? "text-muted-foreground" : undefined} />}
    </>
  )
  // A real link (mailto:) so it reads as one; at the daily cap it becomes a disabled button.
  const openButton = lead.mailto_url ? (
    atCap ? (
      <Button key="open" size={size} variant={c.webmail ? "outline" : "default"} disabled className={cn(compact && "flex-1")}>
        {openLabel}
      </Button>
    ) : (
      <a
        key="open"
        href={lead.mailto_url}
        onClick={c.noteOpened}
        aria-keyshortcuts="O"
        data-slot="open-email-app"
        className={cn(buttonVariants({ variant: c.webmail ? "outline" : "default", size }), compact && "flex-1")}
      >
        {openLabel}
      </a>
    )
  ) : formOnly ? (
    <a
      key="form"
      href={contact.form_url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={c.noteOpened}
      className={cn(buttonVariants({ variant: "outline", size }), compact && "flex-1")}
    >
      <ExternalLinkIcon aria-hidden="true" />
      Open contact form
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : null

  const copyGroup = (
    <div key="copy" className={cn("flex", compact && "flex-1")}>
      <Button
        size={size}
        variant={c.webmail || !lead.mailto_url ? "default" : "outline"}
        onClick={c.copyEmail}
        disabled={atCap || !lead.copy_text}
        aria-keyshortcuts="C"
        className={cn("rounded-r-none", compact && "flex-1")}
      >
        {c.copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {c.copied ? "Copied" : "Copy email"}
        {!compact && <KeyHint keys="C" className={c.webmail || !lead.mailto_url ? undefined : "text-muted-foreground"} />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size={compact ? "icon-lg" : "icon"}
              variant={c.webmail || !lead.mailto_url ? "default" : "outline"}
              aria-label="More copy options"
              disabled={atCap || !contact?.email}
              className="rounded-l-none border-l-[color-mix(in_srgb,currentColor_25%,transparent)]"
            />
          }
        >
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={c.copyAddress}>
            <CopyIcon aria-hidden="true" />
            Copy only the address
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const markButton = (
    <Button
      key="mark"
      size={size}
      variant={c.sentPrompt ? "default" : "outline"}
      onClick={c.markSent}
      disabled={atCap || c.busy !== null}
      aria-keyshortcuts="M"
      className={cn(compact && "flex-1")}
    >
      <SendIcon aria-hidden="true" />
      {c.busy === "sent" ? "Marking…" : "Mark as sent"}
      {!compact && <KeyHint keys="M" className={c.sentPrompt ? undefined : "text-muted-foreground"} />}
    </Button>
  )

  const buttons = c.webmail ? [copyGroup, openButton, markButton] : [openButton, copyGroup, markButton]

  return (
    <section aria-labelledby="sending-preview-title" data-slot="sending-preview" className="space-y-3">
      <p id="sending-preview-title" className="flex items-start gap-2 text-ui text-foreground">
        <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
        <span>
          <span className="font-semibold text-success">Approved.</span> NearbyNudge doesn't send; use your own email
          account.
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-ui">
        <span className="w-6 text-muted-foreground">To</span>
        {contact?.kind === "email" && contact.email ? (
          <>
            <span className="font-medium text-foreground" data-slot="send-to">
              <EmailAddress email={contact.email} />
            </span>
            {contact.source_kind === "listing" ? (
              <SourceTag kind="listing" label={contact.source_label ?? "Business listing"} />
            ) : contact.source_kind && contact.source_label ? (
              <SourceTag kind={contact.source_kind} label={contact.source_label} date={contact.seen_at} href={contact.source_url} />
            ) : null}
          </>
        ) : formOnly ? (
          <span className="text-ink-secondary">Their contact form. Paste the email there.</span>
        ) : (
          <span className="text-ink-secondary">No published address. Copy the email if you reach them another way.</span>
        )}
      </div>
      {c.sentPrompt && !atCap && (
        <p role="status" className="rounded-lg bg-accent px-3 py-2 text-ui font-medium text-foreground">
          Sent it? Mark as sent <KeyHint keys="M" className="ml-0.5" />
        </p>
      )}
      {atCap && sending && (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-warning-tint px-3 py-2 text-ui text-foreground">
          <LockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          You've marked {sending.daily_cap} emails as sent today, the daily limit. Sending unlocks at midnight (
          {formatTime(sending.resets_at)}).
        </p>
      )}
      <div className={cn("flex flex-wrap items-center gap-2", compact && "flex-nowrap")}>{buttons}</div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {sending && (
          <Meter
            label="Sent today"
            value={sending.sent_today}
            max={sending.daily_cap}
            tone={atCap ? "warning" : "default"}
            size="sm"
            barClassName="w-28 flex-none sm:w-40"
          />
        )}
        {!noContact && (
          <Button variant="link" size="xs" className="h-auto px-0 text-meta" onClick={c.toggleWebmail}>
            {c.webmail ? "Use an email app? Make Open the main button" : "Use Gmail or Outlook in the browser? Make Copy the main button"}
          </Button>
        )}
        {lead.last_action?.action === "approve" && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={c.undoLast} disabled={c.busy !== null}>
            <Undo2Icon aria-hidden="true" />
            Undo approval
          </Button>
        )}
      </div>
    </section>
  )
}
