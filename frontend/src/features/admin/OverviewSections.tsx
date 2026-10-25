import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlayIcon } from "lucide-react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { CalmError } from "@/components/CalmError"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { useAiName } from "@/hooks/use-account"
import { useAnnounce } from "@/hooks/use-announce"
import { api } from "@/lib/api"
import { qk } from "@/lib/api/queries"
import type { AdminOverview } from "@/lib/api/types"
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format"
import { FormField, Section, applyServerErrors } from "@/features/settings/form-kit"
import { ChartCard, ColumnChart, DataTable, StatTile, longDay, shortDay, td, tdNum, th, thNum } from "@/features/numbers/viz"
import { Fact, StatusWord, TargetStatus, formatLatency, moneyTick } from "./parts"

const REASONS: Record<string, string> = {
  balance: "The prepaid balance ran out.",
  auth: "The AI provider refused the API key.",
  rate_limited: "The AI provider is limiting requests for now.",
  down: "The AI service isn't answering.",
}

const SKILL_LABELS: Record<string, string> = {
  planner: "Planner",
  scout: "Scout",
  researcher: "Researcher",
  writer: "Writer",
  editor: "Editor",
}

export function skillLabel(skill: string): string {
  return SKILL_LABELS[skill] ?? skill.charAt(0).toUpperCase() + skill.slice(1).replace(/_/gu, " ")
}

// ---------------------------------------------------------------------------
// AI status
// ---------------------------------------------------------------------------

export function AiStatusSection({ overview }: { overview: AdminOverview }) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const { name } = useAiName()
  const { ai } = overview
  const resume = useMutation({
    mutationFn: () => api.resumeAi(),
    onSuccess: (next) => {
      queryClient.setQueryData(qk.admin.overview(), next)
      void queryClient.invalidateQueries({ queryKey: qk.status() })
      // The button goes away once the AI runs again; keep focus in this section.
      window.setTimeout(() => document.querySelector<HTMLElement>("#ai h2")?.focus(), 0)
      announce(next.ai.state === "ok" ? "Research resumed" : "Still paused. The AI isn't answering yet.")
    },
  })
  const state =
    ai.state === "ok" ? (
      <StatusWord tone="good">Running</StatusWord>
    ) : ai.state === "paused" ? (
      <StatusWord tone="paused">Paused</StatusWord>
    ) : (
      <StatusWord tone="warning">Not set up</StatusWord>
    )
  const search =
    ai.web_search === "available" ? (
      <StatusWord tone="good">Available</StatusWord>
    ) : ai.web_search === "unavailable" ? (
      <StatusWord tone="neutral">Unavailable</StatusWord>
    ) : (
      <StatusWord tone="neutral">Not checked yet</StatusWord>
    )
  return (
    <Section
      id="ai"
      title="AI status"
      description="NearbyNudge's one outside service. When it can't be reached, work pauses and resumes later without losing anything."
      actions={
        ai.state === "paused" ? (
          <Button
            aria-disabled={resume.isPending || undefined}
            onClick={() => {
              if (!resume.isPending) resume.mutate()
            }}
          >
            <PlayIcon aria-hidden="true" />
            {resume.isPending ? "Resuming…" : "Resume now"}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="State">{state}</Fact>
        <Fact label="Model">
          {name ? `${name} · ` : ""}
          <span className="font-medium">{ai.model}</span>
        </Fact>
        <Fact label="Web search">{search}</Fact>
        <Fact label="Since">{ai.since ? formatDateTime(ai.since) : ai.state === "ok" ? "No pause recorded" : "Unknown"}</Fact>
        {ai.reason && (
          <Fact label="Reason" className="sm:col-span-2 lg:col-span-4">
            {REASONS[ai.reason] ?? ai.reason}
          </Fact>
        )}
      </dl>
      {ai.state === "unconfigured" && (
        <p className="mt-4 text-ui text-ink-secondary">
          Add the AI provider's API key to the server's .env file and restart the server. Campaigns wait until then.
        </p>
      )}
      {resume.isError && (
        <CalmError size="inline" className="mt-4" title="We couldn't resume the AI" error={resume.error} onRetry={() => resume.mutate()} />
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

export function SpendSection({ overview }: { overview: AdminOverview }) {
  const { spend } = overview
  const daily = spend.daily.map((day) => ({
    key: day.date,
    tick: shortDay(day.date),
    title: longDay(day.date),
    value: day.cost,
  }))
  return (
    <Section
      id="spend"
      title="Spend"
      description="AI cost from the usage records of every request, in US dollars. Days follow UTC."
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatTile label="Today" value={formatMoney(spend.today)} />
          <StatTile label="Last 7 days" value={formatMoney(spend.d7)} />
          <StatTile label="Last 30 days" value={formatMoney(spend.d30)} />
          <StatTile
            label="Per lead, average"
            value={spend.per_lead_avg === null ? <span className="text-pane-title text-muted-foreground">No leads yet</span> : formatMoney(spend.per_lead_avg)}
          />
          <StatTile label="Requests today" value={formatNumber(spend.requests_today)} className="col-span-2 md:col-span-1" />
        </dl>

        <ChartCard
          title="Daily cost, last 30 days"
          description={`Today so far: ${formatMoney(spend.today)}.`}
          chart={
            <ColumnChart
              data={daily}
              series="AI cost"
              chartTitle="AI cost by day, last 30 days"
              format={(value) => formatMoney(value)}
              axisFormat={moneyTick}
              integer={false}
              barSize={14}
              height={196}
            />
          }
          table={
            <DataTable label="Daily AI cost, last 30 days">
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Day
                  </th>
                  <th scope="col" className={thNum}>
                    Cost
                  </th>
                  <th scope="col" className={thNum}>
                    Requests
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...spend.daily].reverse().map((day) => (
                  <tr key={day.date}>
                    <th scope="row" className={`${td} font-normal`}>
                      {longDay(day.date)}
                    </th>
                    <td className={tdNum}>{formatMoney(day.cost)}</td>
                    <td className={tdNum}>{formatNumber(day.requests)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          }
        />

        <div>
          <h3 className="mb-2 text-ui font-semibold text-foreground">By skill, last 30 days</h3>
          {spend.by_skill.length === 0 ? (
            <p className="text-ui text-ink-secondary">No AI requests in the last 30 days.</p>
          ) : (
            <DataTable label="AI spend by skill, last 30 days">
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Skill
                  </th>
                  <th scope="col" className={thNum}>
                    Requests
                  </th>
                  <th scope="col" className={thNum}>
                    Cost
                  </th>
                  <th scope="col" className={thNum}>
                    Average time
                  </th>
                </tr>
              </thead>
              <tbody>
                {spend.by_skill.map((row) => (
                  <tr key={row.skill}>
                    <th scope="row" className={`${td} font-medium`}>
                      {skillLabel(row.skill)}
                    </th>
                    <td className={tdNum}>{formatNumber(row.requests)}</td>
                    <td className={tdNum}>{formatMoney(row.cost)}</td>
                    <td className={tdNum}>{formatLatency(row.avg_latency_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Balance forecast
// ---------------------------------------------------------------------------

const RESERVE_DAYS = 60

const balanceSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Enter the balance in dollars, like 50 or 125.40.")
    .refine((value) => /^\d{1,7}(\.\d{1,2})?$/u.test(value.replace(/[$,\s]/gu, "")), {
      message: "Enter dollars and cents only, like 50 or 125.40.",
    }),
})
type BalanceValues = z.infer<typeof balanceSchema>

export function BalanceSection({ overview }: { overview: AdminOverview }) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const { balance } = overview
  const form = useForm<BalanceValues>({ resolver: zodResolver(balanceSchema), defaultValues: { amount: "" } })
  const { register, handleSubmit, formState, setError, setFocus, reset } = form
  const save = useMutation({
    mutationFn: (amount: number) => api.setAdminBalance({ amount }),
    onSuccess: (next) => {
      queryClient.setQueryData(qk.admin.overview(), next)
      reset({ amount: "" })
      announce(`Balance saved: ${formatMoney(next.balance.amount ?? 0)}`)
    },
    onError: (error) => applyServerErrors(error, { setError, setFocus }, ["amount"]),
  })
  const onSubmit = handleSubmit((values) => {
    if (!save.isPending) save.mutate(Number(values.amount.replace(/[$,\s]/gu, "")))
  })

  const daysLeft = balance.days_left
  let outlook: React.ReactNode = null
  if (balance.amount !== null) {
    if (daysLeft === null) outlook = <StatusWord tone="neutral">Not enough recent spend to forecast</StatusWord>
    else if (daysLeft < RESERVE_DAYS)
      outlook = <StatusWord tone="warning">Under the {RESERVE_DAYS}-day reserve. Top up soon.</StatusWord>
    else outlook = <StatusWord tone="good">More than {RESERVE_DAYS} days of spend left</StatusWord>
  }

  return (
    <Section
      id="balance"
      title="Balance forecast"
      description="Enter the prepaid balance shown in the AI provider's console. NearbyNudge subtracts what it has spent since then and divides by the last 7 days' average."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <form noValidate onSubmit={onSubmit} aria-label="Prepaid balance" className="flex flex-col gap-3">
          <FormField label="Current prepaid balance" error={formState.errors.amount?.message} required>
            {(control) => (
              <InputGroup className="h-9">
                <InputGroupAddon>$</InputGroupAddon>
                <InputGroupInput
                  {...control}
                  {...register("amount")}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="50.00"
                  className="text-base md:text-ui"
                />
              </InputGroup>
            )}
          </FormField>
          <Button type="submit" className="w-fit" aria-disabled={save.isPending || undefined}>
            {save.isPending ? "Saving…" : "Save balance"}
          </Button>
          {save.isError && !formState.errors.amount && (
            <CalmError size="inline" title="We couldn't save the balance" error={save.error} onRetry={() => void onSubmit()} />
          )}
        </form>

        {balance.amount === null ? (
          <p className="text-ui text-ink-secondary lg:pt-7">
            No balance entered yet. Average spend over the last 7 days is {formatMoney(balance.avg_daily)} a day.
          </p>
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fact label="Balance entered">
                <span className="font-semibold">{formatMoney(balance.amount)}</span>
                {balance.as_of && <span className="block text-meta text-muted-foreground">{formatDateTime(balance.as_of)}</span>}
              </Fact>
              <Fact label="Spent since">{formatMoney(balance.spent_since)}</Fact>
              <Fact label="Remaining">
                <span className="font-semibold">{balance.remaining === null ? "Unknown" : formatMoney(balance.remaining)}</span>
              </Fact>
              <Fact label="Average a day, last 7 days">{formatMoney(balance.avg_daily)}</Fact>
              <Fact label="Days left" className="sm:col-span-2 xl:col-span-4">
                <span className="text-pane-title font-semibold">
                  {daysLeft === null ? "Not enough data" : `About ${formatNumber(Math.floor(daysLeft))} ${Math.floor(daysLeft) === 1 ? "day" : "days"}`}
                </span>
              </Fact>
            </dl>
            {outlook && <p className="text-ui">{outlook}</p>}
          </div>
        )}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Queue and quality
// ---------------------------------------------------------------------------

const SUPPORTED_TARGET = 98
const CONTACT_TARGET = 60

function QualityRow({
  label,
  detail,
  value,
  status,
}: {
  label: string
  detail: string
  value: string
  status: React.ReactNode
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-3">
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-ui text-foreground">{label}</p>
        <p className="text-meta text-muted-foreground">{detail}</p>
      </div>
      <div className="flex items-center gap-4">
        <span className="min-w-14 text-right text-pane-title font-semibold text-foreground tabular-nums">{value}</span>
        <span className="w-36 text-ui">{status}</span>
      </div>
    </li>
  )
}

export function QueueQualitySection({ overview }: { overview: AdminOverview }) {
  const { queue, quality } = overview
  const supportedMeets = quality.supported_pct === null ? null : quality.supported_pct >= SUPPORTED_TARGET
  const contactMeets = quality.leads_with_contact_pct === null ? null : quality.leads_with_contact_pct >= CONTACT_TARGET
  return (
    <Section
      id="quality"
      title="Queue and quality"
      description="Research jobs waiting and running now, and the quality measures from the PRD."
    >
      <div className="space-y-6">
        <dl className="grid grid-cols-3 gap-3">
          <StatTile label="Queued" value={formatNumber(queue.queued)} />
          <StatTile label="Running" value={formatNumber(queue.running)} />
          <StatTile label="Failed in 24 h" value={formatNumber(queue.failed_24h)} />
        </dl>
        <ul aria-label="Quality measures" className="divide-y border-y">
          <QualityRow
            label="Audited facts supported by their source"
            detail={`Target ${SUPPORTED_TARGET}% or more · ${formatNumber(quality.audited_facts)} ${quality.audited_facts === 1 ? "fact" : "facts"} audited`}
            value={quality.supported_pct === null ? "–" : `${quality.supported_pct}%`}
            status={<TargetStatus meets={supportedMeets} />}
          />
          <QualityRow
            label="Leads with an email or contact form"
            detail={`Target ${CONTACT_TARGET}% or more`}
            value={quality.leads_with_contact_pct === null ? "–" : `${quality.leads_with_contact_pct}%`}
            status={<TargetStatus meets={contactMeets} />}
          />
          <QualityRow
            label="Average AI cost per lead"
            detail="Every AI request for a lead, including research, writing and checks"
            value={quality.avg_cost_per_lead === null ? "–" : formatMoney(quality.avg_cost_per_lead)}
            status={
              quality.avg_cost_per_lead === null ? <StatusWord tone="neutral">Not measured yet</StatusWord> : null
            }
          />
        </ul>
      </div>
    </Section>
  )
}
