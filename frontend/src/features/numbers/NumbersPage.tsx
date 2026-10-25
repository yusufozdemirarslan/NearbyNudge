import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowDownIcon, ArrowUpIcon, ChartColumnIcon, DownloadIcon, MinusIcon, PlusIcon } from "lucide-react"
import { CalmError } from "@/components/CalmError"
import { EmptyState } from "@/components/EmptyState"
import { Meter } from "@/components/Meter"
import { PageContainer } from "@/components/PageContainer"
import { PageHeader } from "@/components/PageHeader"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { Button, buttonVariants } from "@/components/ui/button"
import { useAnnounce } from "@/hooks/use-announce"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { api } from "@/lib/api"
import { statsQuery } from "@/lib/api/queries"
import type { Funnel as FunnelData, Stats } from "@/lib/api/types"
import { formatDate, formatNumber, formatPercent } from "@/lib/format"
import { downloadBlob } from "@/features/settings/form-kit"
import {
  ChartCard,
  ColumnChart,
  DataTable,
  Funnel,
  StatTile,
  longDay,
  shareOf,
  shortDay,
  td,
  tdNum,
  th,
  thNum,
  type ColumnDatum,
  type FunnelStep,
} from "./viz"

type Measure = keyof FunnelData

const MEASURES: { key: Measure; label: string; hint: string }[] = [
  { key: "found", label: "Found", hint: "Businesses with a finished draft" },
  { key: "approved", label: "Approved", hint: "Emails you approved" },
  { key: "sent", label: "Sent", hint: "Emails you marked sent" },
  { key: "replied", label: "Replies", hint: "Replies you logged" },
]

/** Calm, neutral comparison with last week: an arrow plus words, never color alone. */
function CountDelta({ now, before }: { now: number; before: number }) {
  const diff = now - before
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1">
        <MinusIcon aria-hidden="true" className="size-3.5 shrink-0" />
        Same as last week
      </span>
    )
  }
  const Icon = diff > 0 ? ArrowUpIcon : ArrowDownIcon
  const amount = Math.abs(diff)
  return (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {formatNumber(amount)} {diff > 0 ? "more" : "fewer"} than last week ({formatNumber(before)})
    </span>
  )
}

function rate(f: FunnelData): number | null {
  return f.sent > 0 ? f.replied / f.sent : null
}

function RateDelta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null && before === null) return <span>No sends this week or last</span>
  if (before === null) return <span>No sends last week to compare</span>
  if (now === null) return <span>No sends yet this week; last week {formatPercent(before)}</span>
  const points = Math.round((now - before) * 100)
  if (points === 0) {
    return (
      <span className="inline-flex items-center gap-1">
        <MinusIcon aria-hidden="true" className="size-3.5 shrink-0" />
        Same as last week
      </span>
    )
  }
  const Icon = points > 0 ? ArrowUpIcon : ArrowDownIcon
  return (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {Math.abs(points)} {Math.abs(points) === 1 ? "point" : "points"} {points > 0 ? "higher" : "lower"} than last week
    </span>
  )
}

function HeadlineRow({ stats }: { stats: Stats }) {
  const thisRate = rate(stats.this_week)
  const lastRate = rate(stats.last_week)
  return (
    <section aria-labelledby="headline-title" className="space-y-3">
      <div className="space-y-0.5">
        <h2 id="headline-title" className="text-pane-title font-semibold text-foreground">
          This week
        </h2>
        <p className="text-ui text-ink-secondary">Monday to today, compared with last week. All-time totals under each number.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {MEASURES.map((measure) => (
          <StatTile
            key={measure.key}
            label={measure.label}
            value={formatNumber(stats.this_week[measure.key])}
            detail={
              <CountDelta now={stats.this_week[measure.key]} before={stats.last_week[measure.key]} />
            }
            secondary={`${formatNumber(stats.totals[measure.key])} all time`}
          />
        ))}
        <StatTile
          label="Reply rate"
          value={thisRate === null ? <span className="text-pane-title text-muted-foreground">No sends yet</span> : formatPercent(thisRate)}
          detail={<RateDelta now={thisRate} before={lastRate} />}
          secondary={
            stats.totals.reply_rate === null ? "No sends yet" : `${formatPercent(stats.totals.reply_rate)} all time`
          }
          className="col-span-2 md:col-span-1"
        />
      </dl>
    </section>
  )
}

function FunnelCard({ stats }: { stats: Stats }) {
  const steps: FunnelStep[] = MEASURES.map((m) => ({ key: m.key, label: m.label, value: stats.totals[m.key] }))
  return (
    <ChartCard
      headingLevel={2}
      title="Funnel"
      description="All campaigns, all time. Each step counts the leads that reached it."
      chart={<Funnel steps={steps} />}
      table={
        <DataTable label="Funnel, all campaigns">
          <thead>
            <tr>
              <th scope="col" className={th}>
                Step
              </th>
              <th scope="col" className={thNum}>
                Leads
              </th>
              <th scope="col" className={thNum}>
                Share of found
              </th>
              <th scope="col" className={thNum}>
                Share of the step before
              </th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, index) => (
              <tr key={step.key}>
                <th scope="row" className={`${td} font-medium`}>
                  {step.label}
                </th>
                <td className={tdNum}>{formatNumber(step.value)}</td>
                <td className={tdNum}>{index === 0 ? "100%" : (shareOf(step.value, steps[0].value) ?? "–")}</td>
                <td className={tdNum}>{index === 0 ? "–" : (shareOf(step.value, steps[index - 1].value) ?? "–")}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      }
    />
  )
}

function ByCampaign({ stats }: { stats: Stats }) {
  return (
    <section aria-labelledby="by-campaign-title" className="flex min-w-0 flex-col rounded-xl border bg-card p-4 sm:p-5">
      <h2 id="by-campaign-title" className="text-pane-title font-semibold text-foreground">
        By campaign
      </h2>
      <p className="text-meta text-ink-secondary">Newest first. The CSV export has the same numbers.</p>
      <div className="mt-4 min-w-0">
        <DataTable label="Numbers by campaign">
          <thead>
            <tr>
              <th scope="col" className={th}>
                Campaign
              </th>
              <th scope="col" className={thNum}>
                Found
              </th>
              <th scope="col" className={thNum}>
                Approved
              </th>
              <th scope="col" className={thNum}>
                Sent
              </th>
              <th scope="col" className={thNum}>
                Replies
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.by_campaign.map((row) => (
              <tr key={row.campaign_id}>
                <th scope="row" className={`${td} min-w-44 font-normal`}>
                  <Link
                    to="/campaigns/$campaignId"
                    params={{ campaignId: row.campaign_id }}
                    search={{}}
                    className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="block text-meta text-muted-foreground">Started {formatDate(row.created_at)}</span>
                </th>
                <td className={tdNum}>{formatNumber(row.found)}</td>
                <td className={tdNum}>{formatNumber(row.approved)}</td>
                <td className={tdNum}>{formatNumber(row.sent)}</td>
                <td className={tdNum}>{formatNumber(row.replied)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    </section>
  )
}

function WeeklyCharts({ stats }: { stats: Stats }) {
  return (
    <section aria-labelledby="weekly-title" className="space-y-3">
      <div className="space-y-0.5">
        <h2 id="weekly-title" className="text-pane-title font-semibold text-foreground">
          By week
        </h2>
        <p className="text-ui text-ink-secondary">
          The last 8 weeks, starting on Mondays. Each chart has its own scale, so compare shapes, not heights.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {MEASURES.map((measure) => {
          const data: ColumnDatum[] = stats.weekly.map((week) => ({
            key: week.week_start,
            tick: shortDay(week.week_start),
            title: `Week of ${shortDay(week.week_start)}`,
            value: week[measure.key],
          }))
          const latest = data[data.length - 1]
          return (
            <ChartCard
              key={measure.key}
              title={measure.label}
              description={`${measure.hint}. This week: ${formatNumber(latest?.value ?? 0)}.`}
              chart={<ColumnChart data={data} series={measure.label} chartTitle={`${measure.label} by week`} />}
              table={
                <DataTable label={`${measure.label} by week`}>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>
                        Week of
                      </th>
                      <th scope="col" className={thNum}>
                        {measure.label}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...stats.weekly].reverse().map((week) => (
                      <tr key={week.week_start}>
                        <th scope="row" className={`${td} font-normal`}>
                          {longDay(week.week_start)}
                        </th>
                        <td className={tdNum}>{formatNumber(week[measure.key])}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              }
            />
          )
        })}
      </div>
    </section>
  )
}

function Meters({ stats }: { stats: Stats }) {
  const { sending, usage } = stats
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center sm:gap-8">
      <Meter
        label="Sent today"
        value={sending.sent_today}
        max={sending.daily_cap}
        tone={sending.sent_today >= sending.daily_cap ? "warning" : "default"}
        className="sm:w-80"
      />
      <Meter
        label={`Leads in ${usage.month_label.split(" ")[0]}`}
        value={usage.used}
        max={usage.limit}
        tone={usage.used >= usage.limit ? "warning" : "default"}
        className="sm:w-80"
      />
    </div>
  )
}

function LoadingNumbers() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <div className="h-[52px] rounded-xl border bg-card" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <PlaceholderBar width="5ch" />
            <PlaceholderBar width="3ch" height={28} />
            <PlaceholderBar width="70%" />
          </div>
        ))}
      </div>
      <div className="h-64 rounded-xl border bg-card" />
    </div>
  )
}

/** Numbers (DB5): real counts by week and campaign, the funnel, the meters and the CSV export. */
export function NumbersPage() {
  useDocumentTitle("Numbers")
  const announce = useAnnounce()
  const stats = useQuery(statsQuery())
  const exportCsv = useMutation({
    mutationFn: () => api.downloadStatsCsv(),
    onSuccess: (blob) => {
      downloadBlob(blob, "nearbynudge-numbers.csv")
      announce("Downloaded nearbynudge-numbers.csv")
    },
  })

  const data = stats.data
  const hasCampaigns = Boolean(data && data.by_campaign.length > 0)

  return (
    <PageContainer>
      <PageHeader
        title="Numbers"
        description="Real counts from your campaigns: drafts found, emails you approved and marked sent, and the replies you logged."
        actions={
          <Button
            variant="outline"
            aria-disabled={exportCsv.isPending || !data || undefined}
            onClick={() => {
              if (!exportCsv.isPending && data) exportCsv.mutate()
            }}
          >
            <DownloadIcon aria-hidden="true" />
            {exportCsv.isPending ? "Exporting…" : "Export CSV"}
          </Button>
        }
      >
        {exportCsv.isError && (
          <CalmError
            size="inline"
            title="We couldn't export your numbers"
            error={exportCsv.error}
            onRetry={() => exportCsv.mutate()}
          />
        )}
      </PageHeader>

      {stats.isPending && <LoadingNumbers />}

      {stats.isError && !data && (
        <CalmError title="We couldn't load your numbers" error={stats.error} onRetry={() => void stats.refetch()} />
      )}

      {data && (
        <div className="space-y-8">
          <Meters stats={data} />
          {!hasCampaigns ? (
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={ChartColumnIcon}
                title="No numbers yet"
                description="Numbers appear once your first campaign has drafts. Found counts businesses with a finished draft; approved, sent and replies count what you do on the review desk."
                action={
                  <Link to="/campaigns/new" className={buttonVariants()}>
                    <PlusIcon aria-hidden="true" />
                    New campaign
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              <HeadlineRow stats={data} />
              <div className="grid gap-3 lg:grid-cols-2">
                <FunnelCard stats={data} />
                <ByCampaign stats={data} />
              </div>
              <WeeklyCharts stats={data} />
            </>
          )}
        </div>
      )}
    </PageContainer>
  )
}
