import { useQuery } from "@tanstack/react-query"
import { CirclePauseIcon } from "lucide-react"
import { statusQuery } from "@/lib/api/queries"

const DEFAULT_MESSAGE = "Research paused. We'll resume automatically, and nothing is lost."

/**
 * A calm banner while the AI is paused (balance, outage) or not configured.
 * Driven by GET /api/status, polled every 30 s. Never a red error screen.
 */
export function PausedBanner() {
  const { data } = useQuery(statusQuery())
  if (!data || data.ai_state === "ok") return null
  return (
    <div
      role="status"
      data-slot="paused-banner"
      className="flex items-start gap-2.5 border-b border-[color-mix(in_srgb,var(--info)_25%,transparent)] bg-info-tint px-4 py-2.5 text-ui text-foreground"
    >
      <CirclePauseIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
      <p>{data.message ?? DEFAULT_MESSAGE}</p>
    </div>
  )
}
