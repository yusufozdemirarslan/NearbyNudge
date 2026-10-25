import { useQuery } from "@tanstack/react-query"
import { CalmError } from "@/components/CalmError"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { Button } from "@/components/ui/button"
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format"
import { Section } from "@/features/settings/form-kit"
import { DataTable, td, tdNum, th, thNum } from "@/features/numbers/viz"
import { skillLabel } from "./OverviewSections"
import { StatusWord, formatLatency } from "./parts"
import { AI_CALLS_LIMIT, adminErrorsQuery, aiCallsQuery } from "./queries"

const WHERE_LABELS: Record<string, string> = {
  ai: "AI",
  reader: "Site reader",
  pipeline: "Research pipeline",
  api: "API",
}

function LoadingRows() {
  return (
    <div aria-hidden="true" className="space-y-3">
      {[0, 1, 2].map((i) => (
        <PlaceholderBar key={i} width={`${90 - i * 15}%`} />
      ))}
    </div>
  )
}

export function RecentErrorsSection() {
  const errors = useQuery(adminErrorsQuery())
  return (
    <Section
      id="errors"
      title="Recent errors"
      description="The newest 100 problems the server recorded. Most resolve on their own; repeated ones need a look."
      actions={
        <Button
          variant="outline"
          size="sm"
          aria-disabled={errors.isFetching || undefined}
          onClick={() => {
            if (!errors.isFetching) void errors.refetch()
          }}
        >
          Refresh
        </Button>
      }
    >
      {errors.isPending ? (
        <LoadingRows />
      ) : errors.isError ? (
        <CalmError size="inline" title="We couldn't load the errors" error={errors.error} onRetry={() => void errors.refetch()} />
      ) : errors.data.length === 0 ? (
        <p className="text-ui">
          <StatusWord tone="good">No errors recorded</StatusWord>
        </p>
      ) : (
        <DataTable label="Recent errors">
          <thead>
            <tr>
              <th scope="col" className={th}>
                When
              </th>
              <th scope="col" className={th}>
                Where
              </th>
              <th scope="col" className={th}>
                What happened
              </th>
            </tr>
          </thead>
          <tbody>
            {errors.data.map((entry) => (
              <tr key={entry.id}>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(entry.created_at)}</td>
                <td className={`${td} whitespace-nowrap`}>{WHERE_LABELS[entry.where] ?? entry.where}</td>
                <td className={`${td} min-w-72 [overflow-wrap:anywhere]`}>
                  {entry.message}
                  {(entry.campaign_id || entry.lead_id) && (
                    <span className="mt-0.5 block aside">
                      {entry.campaign_id && `Campaign ${entry.campaign_id.slice(0, 8)}`}
                      {entry.campaign_id && entry.lead_id && ", "}
                      {entry.lead_id && `Lead ${entry.lead_id.slice(0, 8)}`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Section>
  )
}

export function RecentCallsSection() {
  const calls = useQuery(aiCallsQuery())
  return (
    <Section
      id="calls"
      title="Recent AI calls"
      description={`The newest ${AI_CALLS_LIMIT} requests to the AI, with tokens, cost and time. Cached tokens are billed at a lower rate.`}
      actions={
        <Button
          variant="outline"
          size="sm"
          aria-disabled={calls.isFetching || undefined}
          onClick={() => {
            if (!calls.isFetching) void calls.refetch()
          }}
        >
          Refresh
        </Button>
      }
    >
      {calls.isPending ? (
        <LoadingRows />
      ) : calls.isError ? (
        <CalmError size="inline" title="We couldn't load the AI calls" error={calls.error} onRetry={() => void calls.refetch()} />
      ) : calls.data.length === 0 ? (
        <p className="aside">No AI calls yet.</p>
      ) : (
        <DataTable label="Recent AI calls">
          <thead>
            <tr>
              <th scope="col" className={th}>
                When
              </th>
              <th scope="col" className={th}>
                Skill
              </th>
              <th scope="col" className={thNum}>
                Tokens in
              </th>
              <th scope="col" className={thNum}>
                Cached
              </th>
              <th scope="col" className={thNum}>
                Tokens out
              </th>
              <th scope="col" className={thNum}>
                Searches
              </th>
              <th scope="col" className={thNum}>
                Cost
              </th>
              <th scope="col" className={thNum}>
                Time
              </th>
              <th scope="col" className={th}>
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {calls.data.map((call) => (
              <tr key={call.id}>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(call.created_at)}</td>
                <td className={`${td} whitespace-nowrap`}>
                  {skillLabel(call.skill)}
                  {call.thinking && <span className="block aside">Extended thinking</span>}
                </td>
                <td className={tdNum}>{formatNumber(call.prompt_tokens)}</td>
                <td className={tdNum}>{formatNumber(call.cached_tokens)}</td>
                <td className={tdNum}>{formatNumber(call.completion_tokens)}</td>
                <td className={tdNum}>{formatNumber(call.web_search_calls)}</td>
                <td className={tdNum}>{formatMoney(call.cost_usd, { precise: true })}</td>
                <td className={tdNum}>{formatLatency(call.latency_ms)}</td>
                <td className={`${td} min-w-32`}>
                  {call.status === "ok" ? (
                    <StatusWord tone="good">OK</StatusWord>
                  ) : (
                    <>
                      <StatusWord tone="bad">Error</StatusWord>
                      {call.error && (
                        <span className="mt-0.5 block max-w-80 aside [overflow-wrap:anywhere]">
                          {call.error}
                        </span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Section>
  )
}
