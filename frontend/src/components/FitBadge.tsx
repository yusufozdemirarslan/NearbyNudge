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
   * "list" shows the number alone ("92") at the end of a directory line;
   * "display" is the open entry's number, set large at the end of its leader.
   */
  variant?: "header" | "list" | "display"
  className?: string
}

/** One weight ramp for fit everywhere: the number's weight says how strong it is. */
const WEIGHT: Record<FitLabel, string> = {
  Strong: "font-extrabold",
  Good: "font-semibold",
  Weak: "font-normal",
}

/**
 * Fit as a word plus a condensed number: Strong is 80 or more, Good is 60–79
 * and Weak is under 60. The word carries the meaning; the weight echoes it.
 */
export function FitBadge({ score, label, variant = "header", className }: FitBadgeProps) {
  if (score === null) {
    if (variant === "display") {
      return (
        <span className={cn("inline-flex w-14 shrink-0 justify-end", className)}>
          <PlaceholderBar width={40} />
          <span className="sr-only">Fit not scored yet</span>
        </span>
      )
    }
    return variant === "list" ? (
      <span className={cn("inline-flex w-7 justify-end", className)}>
        <PlaceholderBar width={18} />
        <span className="sr-only">Fit not scored yet</span>
      </span>
    ) : (
      <span className={cn("inline-flex items-center text-ui", className)}>
        <PlaceholderBar width={72} />
        <span className="sr-only">Fit not scored yet</span>
      </span>
    )
  }
  const word = label ?? labelFor(score)
  if (variant === "display") {
    return (
      <span
        data-slot="fit-badge"
        data-fit={word}
        className={cn("shrink-0 text-display stretch-condensed tabular-nums", WEIGHT[word], className)}
      >
        <span className="sr-only">{word} fit </span>
        {score}
      </span>
    )
  }
  if (variant === "list") {
    return (
      <span className={cn("inline-block w-7 text-right text-lead stretch-condensed tabular-nums", WEIGHT[word], className)}>
        <span className="sr-only">{word} fit </span>
        {score}
      </span>
    )
  }
  return (
    <span
      data-slot="fit-badge"
      data-fit={word}
      className={cn("inline-flex items-baseline gap-1.5 text-ui whitespace-nowrap", className)}
    >
      <span>{word} fit</span>
      <span className={cn("text-lead stretch-condensed tabular-nums", WEIGHT[word])}>{score}</span>
    </span>
  )
}
