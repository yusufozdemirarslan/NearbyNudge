import type * as React from "react"
import { Mark, type MarkName } from "@/components/Mark"
import { cn } from "@/lib/utils"

/*
 * Small pieces shared by the admin console sections.
 */

export type Tone = "good" | "warning" | "paused" | "bad" | "neutral"

/* Ink for what is fine or waiting; edge red only for what needs someone. */
const TONE: Record<Tone, { mark: MarkName; className: string }> = {
  good: { mark: "check", className: "" },
  warning: { mark: "asterisk", className: "text-edge" },
  paused: { mark: "pause", className: "" },
  bad: { mark: "cross", className: "text-edge" },
  neutral: { mark: "ring", className: "" },
}

/** A state as a drawn mark plus a word, never colour alone (brief §3.3). */
export function StatusWord({
  tone,
  children,
  className,
}: {
  tone: Tone
  children: React.ReactNode
  className?: string
}) {
  const meta = TONE[tone]
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 font-semibold", meta.className, className)}>
      <Mark name={meta.mark} className="translate-y-px" />
      <span>{children}</span>
    </span>
  )
}

/** Meets / below a target, or not measured yet. */
export function TargetStatus({ meets }: { meets: boolean | null }) {
  if (meets === null) return <StatusWord tone="neutral">Not measured yet</StatusWord>
  return meets ? <StatusWord tone="good">Meets target</StatusWord> : <StatusWord tone="warning">Below target</StatusWord>
}

/** A label/value pair for definition-list grids. */
export function Fact({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="aside">{label}</dt>
      <dd className="text-ui [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** "1.4 s" from milliseconds. */
export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

/** Short money ticks for chart axes: "$0", "$0.02", "$0.005", "$12". */
export function moneyTick(value: number): string {
  if (value === 0) return "$0"
  if (value >= 10) return `$${Math.round(value)}`
  const cents = value * 100
  return Math.abs(cents - Math.round(cents)) < 1e-9 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`
}
