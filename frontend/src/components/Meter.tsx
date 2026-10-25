import * as React from "react"
import { cn } from "@/lib/utils"

export interface MeterProps {
  /** Current amount, e.g. 7. */
  value: number
  /** Total, e.g. 20. */
  max: number
  /** What is measured: "Sent today", "Ready". Used as the accessible name. */
  label: string
  /** Visible value text; defaults to "7 of 20". Also the aria-valuetext. */
  valueText?: string
  /**
   * "meter" for a gauge with a limit (daily sends, monthly usage);
   * "progress" for work that finishes (research progress).
   */
  kind?: "meter" | "progress"
  /** "warning" when at or near a limit. */
  tone?: "default" | "warning"
  /** Show the label text before the bar (it stays the accessible name either way). */
  showLabel?: boolean
  /** Bar width; the bar grows to fill by default. */
  barClassName?: string
  size?: "sm" | "md"
  className?: string
}

/**
 * A labelled gauge with its value in words ("Sent today 7 of 20"): a dotted
 * leader track that fills with solid ink, edge red at the limit. Exposed as
 * role="meter" (or "progressbar") with aria-valuetext, so it never relies on
 * the bar alone.
 */
export function Meter({
  value,
  max,
  label,
  valueText,
  kind = "meter",
  tone = "default",
  showLabel = true,
  barClassName,
  size = "md",
  className,
}: MeterProps) {
  const id = React.useId()
  const safeMax = Math.max(1, max)
  const clamped = Math.max(0, Math.min(value, safeMax))
  const text = valueText ?? `${value} of ${max}`
  const warn = tone === "warning"
  return (
    <div
      role={kind === "progress" ? "progressbar" : "meter"}
      aria-labelledby={`${id}-label`}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={text}
      data-slot="meter"
      className={cn("flex min-w-0 items-center gap-2.5", size === "sm" ? "text-meta" : "text-ui", className)}
    >
      <span id={`${id}-label`} className={cn("shrink-0", !showLabel && "sr-only")}>
        {label}
      </span>
      <span aria-hidden="true" className={cn("relative block h-2 min-w-12 flex-1", barClassName)}>
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-b-2 border-dotted border-leader" />
        <span
          className={cn(
            "absolute inset-y-0 left-0 transition-[width] duration-(--dur-state) ease-out",
            warn ? "bg-edge" : "bg-ink"
          )}
          style={{ width: `${(clamped / safeMax) * 100}%` }}
        />
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "shrink-0 numeral",
          size === "sm" ? "text-ui" : "text-lead",
          warn && "text-edge"
        )}
      >
        {text}
      </span>
    </div>
  )
}
