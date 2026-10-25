import * as React from "react"
import { Link } from "@tanstack/react-router"
import { DownloadIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/EmptyState"
import { Mark } from "@/components/Mark"
import { Meter } from "@/components/Meter"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { isInProgress } from "@/components/StatusBadge"
import type { Campaign, LeadSummary } from "@/lib/api/types"
import { formatDuration, formatEta, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { LeadRow } from "./LeadRow"
import { SkipReasons } from "./SkipReasons"
import { DESK_VIEWS, VIEW_LABEL, VIEW_STATUSES, type DeskSort, type DeskView } from "./search"
import type { StableOrder } from "./use-stable-order"

export interface ListCounts {
  byView: Record<DeskView, number>
  inProgress: number
  drafted: number
  denominator: number
}

/** Counts per view, computed from the list itself so tabs always match rows. */
export function countLeads(leads: LeadSummary[] | undefined, target: number): ListCounts {
  const byView = Object.fromEntries(DESK_VIEWS.map((v) => [v, 0])) as Record<DeskView, number>
  let failed = 0
  for (const lead of leads ?? []) {
    byView.all += 1
    for (const view of DESK_VIEWS) {
      if (view !== "all" && VIEW_STATUSES[view].includes(lead.status)) byView[view] += 1
    }
    if (lead.status === "failed") failed += 1
  }
  const inProgress = byView.in_progress
  const drafted = byView.all - inProgress - failed
  const denominator = leads && leads.length > 0 ? Math.max(1, byView.all - failed) : target
  return { byView, inProgress, drafted, denominator }
}

function emptyCopy(view: DeskView, counts: ListCounts, running: boolean): { title: string; description: string } {
  const still =
    counts.inProgress > 0 ? `${plural(counts.inProgress, "lead")} ${counts.inProgress === 1 ? "is" : "are"} still being researched.` : ""
  switch (view) {
    case "ready":
      return {
        title: "No leads are ready yet",
        description: still || (running ? "Research is starting." : "Check Needs review or All for the rest."),
      }
    case "needs_review":
      return { title: "No leads need review", description: still || "Every draft passed its checks." }
    case "in_progress":
      return { title: "Nothing is being researched right now", description: "Every lead has finished." }
    case "approved":
      return { title: "No approved emails waiting", description: "Approve a draft and it waits here until you mark it sent." }
    case "sent":
      return { title: "Nothing marked as sent yet", description: "After you send an approved email from your own account, mark it as sent." }
    case "skipped":
      return { title: "No skipped leads", description: "Leads you skip or block appear here." }
    case "failed":
      return { title: "Every lead finished", description: "None of the businesses needed a retry." }
    default:
      return {
        title: running ? "Finding businesses" : "No leads in this campaign",
        description: running ? "The first ones appear within about 30 seconds." : "Try a bigger radius or a broader industry.",
      }
  }
}

const FINISH_KEY = (id: string) => `nn-finish-dismissed-${id}`

function useFinishDismissed(campaignId: string) {
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return window.localStorage.getItem(FINISH_KEY(campaignId)) === "1"
    } catch {
      return false
    }
  })
  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(FINISH_KEY(campaignId), "1")
    } catch {
      // ignore
    }
  }
  return [dismissed, dismiss] as const
}

export interface LeadListProps {
  campaign: Campaign | undefined
  leads: LeadSummary[] | undefined
  loading: boolean
  order: StableOrder
  view: DeskView
  sort: DeskSort
  selectedId: string | undefined
  checked: ReadonlySet<string>
  onCheckedChange: (next: ReadonlySet<string>) => void
  compact: boolean
  livePaused: boolean
  liveWaiting: number
  onLivePausedChange: (paused: boolean) => void
  onViewChange: (view: DeskView) => void
  onSortChange: (sort: DeskSort) => void
  onOpenLead: (id: string) => void
  onReviewFirst: (() => void) | null
  onExportAll: () => void
  onExportSelected: () => void
  onBulkSkip: (reason: string) => void
  bulkBusy: boolean
  /** "vertical": the thumb index is cut into the list's side edge; "horizontal": along its top. */
  orientation?: "vertical" | "horizontal"
  className?: string
}

/** The view counts on the thumb tabs: a count that changes ticks once (the end of a filing). */
function TabCount({ value }: { value: number }) {
  const previous = React.useRef<number | null>(null)
  const changed = previous.current !== null && previous.current !== value
  React.useEffect(() => {
    previous.current = value
  }, [value])
  return (
    <span key={value} className={cn("numeral text-ui tabular-nums", changed && "animate-tick")}>
      {value}
    </span>
  )
}

/** The review desk's lead list column: the campaign's running head, the thumb index and the entries. */
export function LeadList(props: LeadListProps) {
  const {
    campaign,
    leads,
    loading,
    order,
    view,
    sort,
    selectedId,
    checked,
    onCheckedChange,
    compact,
    livePaused,
    liveWaiting,
    onLivePausedChange,
    onViewChange,
    onSortChange,
    onOpenLead,
    onReviewFirst,
    orientation = "vertical",
    className,
  } = props
  const vertical = orientation === "vertical"
  const listRef = React.useRef<HTMLUListElement>(null)
  const counts = countLeads(leads, campaign?.lead_target ?? 10)
  const running = campaign ? campaign.status === "finding" || campaign.status === "researching" : false
  const finding = campaign?.status === "finding" || (running && (leads?.length ?? 0) === 0)
  const visibleViews = DESK_VIEWS.filter((v) => v === "all" || v === view || counts.byView[v] > 0)
  const rows = order.rows
  const rowIds = rows.map((r) => r.id)
  const focusTarget = selectedId && rowIds.includes(selectedId) ? selectedId : rowIds[0]

  const onRowKeyDown = React.useCallback(
    (lead: LeadSummary) => (event: React.KeyboardEvent<HTMLAnchorElement>) => {
      const links = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-row-link]") ?? [])
      const index = links.indexOf(event.currentTarget)
      let next: HTMLAnchorElement | undefined
      if (event.key === "ArrowDown") next = links[Math.min(links.length - 1, index + 1)]
      else if (event.key === "ArrowUp") next = links[Math.max(0, index - 1)]
      else if (event.key === "Home") next = links[0]
      else if (event.key === "End") next = links[links.length - 1]
      else if (event.key === " ") {
        event.preventDefault()
        const nextChecked = new Set(checked)
        if (nextChecked.has(lead.id)) nextChecked.delete(lead.id)
        else nextChecked.add(lead.id)
        onCheckedChange(nextChecked)
        return
      }
      if (next) {
        event.preventDefault()
        next.focus()
        next.scrollIntoView({ block: "nearest" })
      }
    },
    [checked, onCheckedChange]
  )

  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id))
  const someChecked = rows.some((r) => checked.has(r.id))

  const tabs = (
    <TabsList
      aria-label="Lead status"
      className={cn(
        vertical
          ? "w-11 shrink-0 flex-col flex-nowrap items-end gap-2.5 overflow-y-auto border-r-2 border-ink pt-5 pb-4"
          : "w-full flex-nowrap gap-1 overflow-x-auto border-b-2 border-ink px-4 pt-2"
      )}
    >
      {visibleViews.map((v) => (
        <TabsTrigger key={v} value={v} className={cn("shrink-0", vertical ? "text-meta" : "text-meta sm:text-ui")}>
          {VIEW_LABEL[v]}
          <TabCount value={counts.byView[v]} />
        </TabsTrigger>
      ))}
    </TabsList>
  )

  return (
    <section aria-labelledby="desk-campaign-title" className={cn("flex min-h-0 bg-paper", className)}>
      <Tabs
        value={view}
        orientation={orientation}
        onValueChange={(value) => onViewChange(value as DeskView)}
        className={cn("min-h-0 min-w-0 flex-1 gap-0", vertical ? "flex-row" : "flex-col")}
      >
        {vertical && tabs}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CampaignHeader
            campaign={campaign}
            counts={counts}
            running={running}
            livePaused={livePaused}
            liveWaiting={liveWaiting}
            onLivePausedChange={onLivePausedChange}
            onReviewFirst={onReviewFirst}
            onExportAll={props.onExportAll}
          />
          {!vertical && tabs}

          <div className="flex min-h-11 items-center gap-2 border-b border-ink pr-4">
            {someChecked ? (
              <div className="w-full pl-4">
                <BulkBar
                  count={rows.filter((r) => checked.has(r.id)).length}
                  busy={props.bulkBusy}
                  onSkip={props.onBulkSkip}
                  onExport={props.onExportSelected}
                  onClear={() => onCheckedChange(new Set())}
                />
              </div>
            ) : (
              <>
                <span className="flex w-9 shrink-0 justify-center">
                  <Checkbox
                    checked={allChecked}
                    indeterminate={someChecked && !allChecked}
                    onCheckedChange={(value) => onCheckedChange(value ? new Set(rows.map((r) => r.id)) : new Set())}
                    aria-label="Select all leads in this view"
                    disabled={rows.length === 0}
                  />
                </span>
                <span className="aside">{rows.length > 0 ? plural(rows.length, "lead") : ""}</span>
                <label className="ml-auto flex items-center gap-2 aside">
                  Sort
                  <NativeSelect
                    size="sm"
                    value={sort}
                    onChange={(event) => onSortChange(event.target.value as DeskSort)}
                    className="w-auto not-italic"
                  >
                    <NativeSelectOption value="fit">Best fit</NativeSelectOption>
                    <NativeSelectOption value="distance">Nearest</NativeSelectOption>
                    <NativeSelectOption value="name">Name</NativeSelectOption>
                  </NativeSelect>
                </label>
              </>
            )}
          </div>

          <TabsContent
            value={view}
            className={cn("relative min-h-0 flex-1 overflow-y-auto", livePaused && "motion-paused")}
          >
            {order.held.length > 0 && (
              <div className="sticky top-0 z-10 flex justify-center border-b border-ink bg-paper px-4 py-2">
                <Button size="sm" variant="outline" onClick={order.showHeld}>
                  {order.held.length === 1 ? "1 new lead above" : `${order.held.length} new leads above`}
                </Button>
              </div>
            )}
            {loading && !leads ? (
              <PlaceholderRows count={6} compact={compact} />
            ) : rows.length > 0 ? (
              <div className="pb-6">
                <ul ref={listRef}>
                  {rows.map((lead) => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      selected={lead.id === selectedId}
                      checked={checked.has(lead.id)}
                      tabIndex={lead.id === focusTarget ? 0 : -1}
                      compact={compact}
                      fresh={order.fresh.has(lead.id)}
                      still={livePaused}
                      onToggleChecked={(value) => {
                        const next = new Set(checked)
                        if (value) next.add(lead.id)
                        else next.delete(lead.id)
                        onCheckedChange(next)
                      }}
                      onOpen={() => onOpenLead(lead.id)}
                      onKeyDown={onRowKeyDown(lead)}
                    />
                  ))}
                </ul>
                {finding && <PlaceholderRows count={Math.max(0, (campaign?.lead_target ?? 6) - rows.length)} compact={compact} />}
              </div>
            ) : finding ? (
              <div>
                <p className="px-4 pt-4 pb-2 aside">
                  {campaign?.status_detail ?? `Finding businesses near ${campaign?.location_label ?? "you"}…`}
                </p>
                <PlaceholderRows count={campaign?.lead_target ?? 6} compact={compact} />
              </div>
            ) : (
              <EmptyState
                size="inline"
                {...emptyCopy(view, counts, running)}
                action={
                  view !== "all" ? (
                    <Button variant="outline" size="sm" onClick={() => onViewChange("all")}>
                      Show all leads
                    </Button>
                  ) : undefined
                }
              />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </section>
  )
}

function PlaceholderRows({ count, compact }: { count: number; compact: boolean }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn("flex flex-col justify-center gap-2 border-b border-hairline pr-4 pl-13", compact ? "h-9" : "h-14")}>
          <PlaceholderBar width={`${55 + ((i * 17) % 30)}%`} className="block" />
          {!compact && <PlaceholderBar width={`${30 + ((i * 11) % 20)}%`} className="block" />}
        </div>
      ))}
    </div>
  )
}

function CampaignHeader({
  campaign,
  counts,
  running,
  livePaused,
  liveWaiting,
  onLivePausedChange,
  onReviewFirst,
  onExportAll,
}: {
  campaign: Campaign | undefined
  counts: ListCounts
  running: boolean
  livePaused: boolean
  liveWaiting: number
  onLivePausedChange: (paused: boolean) => void
  onReviewFirst: (() => void) | null
  onExportAll: () => void
}) {
  const switchId = React.useId()
  const [dismissed, dismiss] = useFinishDismissed(campaign?.id ?? "none")
  const eta = running ? formatEta(campaign?.eta_seconds) : null
  const summary = campaign?.status === "done" && campaign.finish_summary && !dismissed ? campaign.finish_summary : null
  return (
    <div className="space-y-3 px-4 pt-5 pb-4">
      <div className="flex items-start justify-between gap-2 border-b-(length:--rule-heavy) border-ink pb-2">
        <h1 id="desk-campaign-title" className="min-w-0 text-head uppercase stretch-condensed">
          {campaign ? campaign.name : <PlaceholderBar width="80%" />}
        </h1>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onExportAll}
          aria-label="Export all leads as a spreadsheet (CSV)"
          className="-mr-2 shrink-0"
        >
          <DownloadIcon aria-hidden="true" />
        </Button>
      </div>
      {campaign && (
        <div className="space-y-1.5">
          <Meter
            kind="progress"
            label="Ready"
            showLabel={false}
            value={counts.drafted}
            max={counts.denominator}
            valueText={`${counts.drafted} of ${counts.denominator} ready`}
            size="sm"
          />
          <p className="aside" aria-live="off">
            {campaign.status === "finding"
              ? (campaign.status_detail ?? "Finding businesses…")
              : running
                ? eta
                  ? `Researching, ${eta}.`
                  : "Researching."
                : campaign.status === "paused"
                  ? "Research paused. It resumes automatically."
                  : campaign.status === "failed"
                    ? "This campaign stopped early."
                    : "Research finished."}
          </p>
        </div>
      )}
      {running && (
        <div className="flex items-center gap-2.5">
          <Switch
            id={switchId}
            checked={livePaused}
            onCheckedChange={(value) => onLivePausedChange(Boolean(value))}
            size="sm"
          />
          <label htmlFor={switchId} className="text-meta">
            Pause live updates
          </label>
          {livePaused && liveWaiting > 0 && (
            <span className="ml-auto text-meta font-semibold">{plural(liveWaiting, "change")} waiting</span>
          )}
        </div>
      )}
      {onReviewFirst && (
        <Button size="sm" onClick={onReviewFirst} className="w-full">
          Review first lead
        </Button>
      )}
      {summary && campaign ? (
        <div className="border border-ink p-3 text-meta">
          <div className="flex items-start justify-between gap-2">
            <p className="font-bold">Research finished in {formatDuration(summary.seconds)}</p>
            <Button variant="ghost" size="icon-xs" onClick={dismiss} aria-label="Dismiss the summary" className="-mt-1 -mr-1">
              <XIcon aria-hidden="true" />
            </Button>
          </div>
          <p className="mt-1">
            Found {summary.found}. {summary.ready} ready, {summary.needs_review} need review
            {summary.failed.length > 0 ? `, ${summary.failed.length} couldn't finish` : ""}
            {summary.replaced.length > 0 ? `, ${summary.replaced.length} replaced` : ""}.
          </p>
          {summary.failed.length > 0 && (
            <ul className="mt-2 space-y-1">
              {summary.failed.map((item) => (
                <li key={item.lead_id}>
                  <Link
                    to="/campaigns/$campaignId"
                    params={{ campaignId: campaign.id }}
                    search={(prev) => ({ ...prev, view: "failed", lead: item.lead_id })}
                    className="font-semibold underline underline-offset-[3px] hover:text-edge"
                  >
                    {item.name}
                  </Link>
                  : <span className="italic">{item.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.replaced.length > 0 && (
            <ul className="mt-2 space-y-1">
              {summary.replaced.map((item) => (
                <li key={item.name}>
                  <span className="font-semibold">Replaced {item.name}</span>: <span className="italic">{item.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        campaign &&
        campaign.notices.length > 0 && (
          <ul className="space-y-1.5">
            {campaign.notices.map((notice) => (
              <li key={notice} className="flex gap-2 aside">
                <Mark name="dot" className="mt-1 size-2" />
                <span>{notice}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

function BulkBar({
  count,
  busy,
  onSkip,
  onExport,
  onClear,
}: {
  count: number
  busy: boolean
  onSkip: (reason: string) => void
  onExport: () => void
  onClear: () => void
}) {
  const [choosing, setChoosing] = React.useState(false)
  if (choosing) {
    return (
      <SkipReasons
        title={`Skip ${plural(count, "lead")}: why?`}
        compact
        busy={busy}
        onChoose={(reason) => {
          onSkip(reason)
          setChoosing(false)
        }}
        onCancel={() => setChoosing(false)}
      />
    )
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 py-1">
      <span className="mr-auto text-ui font-bold">{count} selected</span>
      <Button size="xs" variant="outline" onClick={() => setChoosing(true)} disabled={busy}>
        Skip…
      </Button>
      <Button size="xs" variant="outline" onClick={onExport} disabled={busy}>
        Export CSV
      </Button>
      <Button size="xs" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}

/** True for leads the user can act on now. */
export const isActionable = (lead: Pick<LeadSummary, "status">) =>
  lead.status === "ready" || lead.status === "needs_review"

export { isInProgress }
