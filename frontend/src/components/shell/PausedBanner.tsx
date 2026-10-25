import { useQuery } from "@tanstack/react-query"
import { Mark } from "@/components/Mark"
import { statusQuery } from "@/lib/api/queries"

const DEFAULT_MESSAGE = "Research paused. We'll resume automatically, and nothing is lost."

/**
 * A calm notice under the masthead while the AI is paused (balance, outage)
 * or not configured. Driven by GET /api/status, polled every 30 s.
 */
export function PausedBanner() {
  const { data } = useQuery(statusQuery())
  if (!data || data.ai_state === "ok") return null
  return (
    <div
      role="status"
      data-slot="paused-banner"
      className="flex items-center gap-2.5 border-b border-ink bg-paper px-4 py-2.5 text-ui font-semibold sm:px-6"
    >
      <Mark name="pause" className="size-3.5" />
      <p>{data.message ?? DEFAULT_MESSAGE}</p>
    </div>
  )
}
