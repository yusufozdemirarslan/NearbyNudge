import type { LeadStatus, ReplyOutcome } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Mark, type MarkName } from "./Mark"

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
  mark: MarkName
  /** Edge red for "needs you"; everything else is ink. */
  urgent?: boolean
  /** Set in bold: the statuses that want a decision. */
  strong?: boolean
}

const META: Record<LeadStatus, Meta> = {
  queued: { word: "Queued", mark: "ring" },
  reading: { word: "Reading site", mark: "dot" },
  choosing: { word: "Choosing hook", mark: "dot" },
  writing: { word: "Writing", mark: "dot" },
  checking: { word: "Checking", mark: "dot" },
  ready: { word: "Ready", mark: "square", strong: true },
  needs_review: { word: "Needs review", mark: "asterisk", urgent: true, strong: true },
  approved: { word: "Approved", mark: "check" },
  sent: { word: "Sent", mark: "envelope" },
  replied: { word: "Replied", mark: "reply" },
  skipped: { word: "Skipped", mark: "slash" },
  dnc: { word: "Do not contact", mark: "barred", urgent: true },
  failed: { word: "Couldn't finish", mark: "cross" },
}

export interface StatusBadgeProps {
  status: LeadStatus
  /** Backend stage label ("Reading site"); falls back to the standard word. */
  stageLabel?: string | null
  /** Research step 1–4 while in progress; shown as "step 2 of 4". */
  step?: number | null
  /** For sent: the sent date ("Sent Oct 24"). */
  date?: string | null
  /** For skipped / failed: the reason, shown after the word. */
  reason?: string | null
  /** For replied: the logged outcome. */
  replyOutcome?: ReplyOutcome | null
  /** "sm" in lists (13px), "md" in headers (14px). */
  size?: "sm" | "md"
  /**
   * Let the active stage's dot pulse. Pass false when live updates are
   * paused; reduced-motion settings stop it regardless.
   */
  animate?: boolean
  /** Hide the step count. */
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
 * One status vocabulary: a drawn mark and a word, always both, so colour is
 * never the only signal. Needs review and Do not contact are edge red; the
 * working stages carry their step in italic, and only they pulse.
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
  const active = inProgress && status !== "queued"
  let detail: string | null = null
  if (inProgress && s && !hideStep) detail = `step ${s} of 4`
  else if (status === "sent" && date) detail = formatDate(date)
  else if (status === "replied" && replyOutcome) detail = REPLY_WORD[replyOutcome]
  else if ((status === "skipped" || status === "failed") && reason) detail = reason

  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap",
        size === "sm" ? "text-meta" : "text-ui",
        meta.urgent && "text-edge",
        className
      )}
    >
      <Mark
        name={meta.mark}
        className={cn(active && animate && "animate-working motion-reduce:animate-none")}
      />
      <span className={cn("truncate", meta.strong && "font-semibold")}>
        {word}
        {detail && (
          <>
            {status === "sent" ? " " : inProgress ? ", " : ": "}
            <span className={cn(inProgress && "italic tabular-nums")}>{detail}</span>
          </>
        )}
      </span>
    </span>
  )
}
