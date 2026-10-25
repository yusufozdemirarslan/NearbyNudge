import type { FitLabel } from "@/lib/api/types"
import { fitLabel as labelFor } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PlaceholderBar } from "./PlaceholderBar"

export interface FitBadgeProps {
  /** 0–100, or null while the lead is still being scored. */
  score: number | null
  /** From the API; derived from the score when missing. */
  label?: FitLabel | null
  /**
   * "header" shows the word and the number ("Strong fit 92");
   * "list" shows the number alone ("92") for number columns.
   */
  variant?: "header" | "list"
  className?: string
}

const TONE: Record<FitLabel, string> = {
  Strong: "bg-accent text-accent-foreground",
  Good: "bg-secondary text-secondary-foreground",
  Weak: "bg-muted text-ink-secondary",
}

/**
 * Fit as a word plus a number: Strong is 80 or more, Good is 60–79 and Weak
 * is under 60 (brief §3.2). The word carries the meaning; color only echoes it.
 */
export function FitBadge({ score, label, variant = "header", className }: FitBadgeProps) {
  if (score === null) {
    return variant === "list" ? (
      <span className={cn("inline-flex w-6 justify-end", className)}>
        <PlaceholderBar width={16} />
        <span className="sr-only">Fit not scored yet</span>
      </span>
    ) : (
      <span className={cn("inline-flex items-center gap-1.5 text-ui text-muted-foreground", className)}>
        <PlaceholderBar width={84} />
        <span className="sr-only">Fit not scored yet</span>
      </span>
    )
  }
  const word = label ?? labelFor(score)
  if (variant === "list") {
    return (
      <span className={cn("inline-block w-6 text-right text-list font-semibold tabular-nums", className)}>
        <span className="sr-only">{word} fit </span>
        {score}
      </span>
    )
  }
  return (
    <span
      data-slot="fit-badge"
      data-fit={word}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-ui whitespace-nowrap",
        TONE[word],
        className
      )}
    >
      <span className="font-medium">{word} fit</span>
      <span className="font-semibold tabular-nums">{score}</span>
    </span>
  )
}
