import {
  BanIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  MessageSquareIcon,
  SendIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import type { LeadStatus, ReplyOutcome } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Lead statuses that mean research is still running. */
export const IN_PROGRESS_STATUSES: LeadStatus[] = ["queued", "reading", "choosing", "writing", "checking"]

export const isInProgress = (status: LeadStatus) => IN_PROGRESS_STATUSES.includes(status)

const STAGE_WORD: Partial<Record<LeadStatus, string>> = {
  queued: "Queued",
  reading: "Reading site",
  choosing: "Choosing hook",
  writing: "Writing",
  checking: "Checking",
}

const STEP: Partial<Record<LeadStatus, number>> = { reading: 1, choosing: 2, writing: 3, checking: 4 }

const REPLY_WORD: Record<ReplyOutcome, string> = {
  interested: "Interested",
  no_thanks: "No thanks",
  other: "Other reply",
}

interface Meta {
  word: string
  icon: LucideIcon | "dot" | "ring"
  iconClass: string
  textClass: string
}

const META: Record<LeadStatus, Meta> = {
  queued: { word: "Queued", icon: "ring", iconClass: "text-muted-foreground", textClass: "text-muted-foreground" },
  reading: { word: "Reading site", icon: "dot", iconClass: "bg-muted-foreground", textClass: "text-muted-foreground" },
  choosing: { word: "Choosing hook", icon: "dot", iconClass: "bg-muted-foreground", textClass: "text-muted-foreground" },
  writing: { word: "Writing", icon: "dot", iconClass: "bg-muted-foreground", textClass: "text-muted-foreground" },
  checking: { word: "Checking", icon: "dot", iconClass: "bg-muted-foreground", textClass: "text-muted-foreground" },
  ready: { word: "Ready", icon: "dot", iconClass: "bg-primary", textClass: "text-foreground" },
  needs_review: { word: "Needs review", icon: TriangleAlertIcon, iconClass: "text-warning", textClass: "text-warning" },
  approved: { word: "Approved", icon: CircleCheckIcon, iconClass: "text-success", textClass: "text-success" },
  sent: { word: "Sent", icon: SendIcon, iconClass: "text-foreground", textClass: "text-foreground" },
  replied: { word: "Replied", icon: MessageSquareIcon, iconClass: "text-info", textClass: "text-info" },
  skipped: { word: "Skipped", icon: BanIcon, iconClass: "text-muted-foreground", textClass: "text-muted-foreground" },
  dnc: { word: "Do not contact", icon: CircleMinusIcon, iconClass: "text-destructive", textClass: "text-destructive" },
  failed: { word: "Couldn't finish", icon: CircleAlertIcon, iconClass: "text-muted-foreground", textClass: "text-muted-foreground" },
}

export interface StatusBadgeProps {
  status: LeadStatus
  /** Backend stage label ("Reading site"); falls back to the standard word. */
  stageLabel?: string | null
  /** Research step 1–4 while in progress; shown as "2 of 4". */
  step?: number | null
  /** For sent: the sent date ("Sent Oct 24"). */
  date?: string | null
  /** For skipped / failed: the reason, shown after the word. */
  reason?: string | null
  /** For replied: the logged outcome. */
  replyOutcome?: ReplyOutcome | null
  /** "sm" in lists (12px), "md" in headers (14px). */
  size?: "sm" | "md"
  /**
   * Let the active stage's dot pulse. Pass false when live updates are
   * paused; reduced-motion settings stop it regardless.
   */
  animate?: boolean
  /** Hide the step count ("2 of 4"). */
  hideStep?: boolean
  className?: string
}

/** The words a status reads as, e.g. "Writing, 3 of 4" or "Skipped: Not a fit". */
export function statusText({
  status,
  stageLabel,
  step,
  date,
  reason,
  replyOutcome,
}: Pick<StatusBadgeProps, "status" | "stageLabel" | "step" | "date" | "reason" | "replyOutcome">): string {
  const meta = META[status]
  const word = isInProgress(status) ? (stageLabel ?? STAGE_WORD[status] ?? meta.word) : meta.word
  const s = step ?? STEP[status]
  if (isInProgress(status) && s) return `${word}, ${s} of 4`
  if (status === "sent" && date) return `${word} ${formatDate(date)}`
  if (status === "replied" && replyOutcome) return `${word}: ${REPLY_WORD[replyOutcome]}`
  if ((status === "skipped" || status === "failed") && reason) return `${word}: ${reason}`
  return word
}

/**
 * One status vocabulary (brief §3.3): every status pairs an icon with a word,
 * so color is never the only signal. In-progress statuses show the stage and
 * a step count; only active stages (not Queued) get a moving dot.
 */
export function StatusBadge({
  status,
  stageLabel,
  step,
  date,
  reason,
  replyOutcome,
  size = "sm",
  animate = true,
  hideStep = false,
  className,
}: StatusBadgeProps) {
  const meta = META[status]
  const inProgress = isInProgress(status)
  const word = inProgress ? (stageLabel ?? STAGE_WORD[status] ?? meta.word) : meta.word
  const s = step ?? STEP[status]
  const iconSize = "size-4"
  const active = inProgress && status !== "queued"
  let detail: string | null = null
  if (inProgress && s && !hideStep) detail = `${s} of 4`
  else if (status === "sent" && date) detail = formatDate(date)
  else if (status === "replied" && replyOutcome) detail = REPLY_WORD[replyOutcome]
  else if ((status === "skipped" || status === "failed") && reason) detail = reason

  const Icon = meta.icon
  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap",
        size === "sm" ? "text-meta" : "text-ui",
        meta.textClass,
        className
      )}
    >
      <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center", iconSize)}>
        {Icon === "dot" ? (
          <span
            className={cn(
              "block size-2 rounded-full",
              meta.iconClass,
              active && animate && "animate-working motion-reduce:animate-none"
            )}
          />
        ) : Icon === "ring" ? (
          <span className="block size-2 rounded-full border-[1.5px] border-current" />
        ) : (
          <Icon className={cn(iconSize, meta.iconClass)} />
        )}
      </span>
      <span className={cn("truncate", (status === "ready" || status === "needs_review") && "font-medium")}>
        {word}
        {detail && (
          <>
            {status === "sent" ? " " : inProgress ? <span className="text-muted-foreground"> · </span> : ": "}
            <span className={cn(inProgress && "tabular-nums")}>{detail}</span>
          </>
        )}
      </span>
    </span>
  )
}
