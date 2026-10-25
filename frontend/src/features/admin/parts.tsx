import type * as React from "react"
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePauseIcon,
  CircleXIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

/*
 * Small pieces shared by the admin console sections.
 */

export type Tone = "good" | "warning" | "paused" | "bad" | "neutral"

const TONE: Record<Tone, { icon: LucideIcon; className: string }> = {
  good: { icon: CircleCheckIcon, className: "text-success" },
  warning: { icon: TriangleAlertIcon, className: "text-warning" },
  paused: { icon: CirclePauseIcon, className: "text-info" },
  bad: { icon: CircleXIcon, className: "text-destructive" },
  neutral: { icon: CircleDashedIcon, className: "text-ink-secondary" },
}

/** A state as an icon plus a word, never color alone (brief §3.3). */
export function StatusWord({
  tone,
  icon,
  children,
  className,
}: {
  tone: Tone
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
}) {
  const meta = TONE[tone]
  const Icon = icon ?? meta.icon
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", meta.className, className)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
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
      <dt className="text-meta text-ink-secondary">{label}</dt>
      <dd className="text-ui text-foreground [overflow-wrap:anywhere]">{children}</dd>
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
