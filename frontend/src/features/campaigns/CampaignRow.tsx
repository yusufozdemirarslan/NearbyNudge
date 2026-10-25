import { Link } from "@tanstack/react-router"
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CirclePauseIcon,
} from "lucide-react"
import { Meter } from "@/components/Meter"
import type { CampaignSummary, LeadCounts } from "@/lib/api/types"
import { formatDate, formatEta, plural } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Leads whose research and draft are finished (not in progress, not "Couldn't finish"). */
export function draftedCount(counts: LeadCounts): number {
  return Math.max(0, counts.total - counts.in_progress - counts.failed)
}

export const isRunning = (campaign: CampaignSummary) =>
  campaign.status === "finding" || campaign.status === "researching"

/** Count columns on wide screens, in reading order. */
export const COUNT_COLUMNS: {
  key: keyof LeadCounts
  label: string
  one: string
  many: string
}[] = [
  { key: "ready", label: "Ready", one: "ready", many: "ready" },
  {
    key: "needs_review",
    label: "Needs review",
    one: "needs review",
    many: "need review",
  },
  { key: "approved", label: "Approved", one: "approved", many: "approved" },
  { key: "sent", label: "Sent", one: "sent", many: "sent" },
  { key: "replied", label: "Replies", one: "reply", many: "replies" },
]

/** Grid shared by the header row and every campaign row (wide screens only). */
export const ROW_GRID =
  "xl:grid xl:grid-cols-[minmax(0,1fr)_15rem_repeat(5,5rem)_1.25rem] xl:items-center xl:gap-x-4"

function WorkingDot({ animate }: { animate: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center"
    >
      <span
        className={cn(
          "block size-2 rounded-full bg-muted-foreground",
          animate && "animate-working motion-reduce:animate-none"
        )}
      />
    </span>
  )
}

/**
 * A campaign's state as an icon plus words (brief 3.3): finding, researching
 * with "7 of 10 ready", paused with the calm message, done, or couldn't finish.
 */
export function CampaignStatusLine({
  campaign,
  animate,
}: {
  campaign: CampaignSummary
  animate: boolean
}) {
  const drafted = draftedCount(campaign.counts)
  const target = Math.max(campaign.lead_target, 1)
  switch (campaign.status) {
    case "finding":
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-ui text-foreground">
            <WorkingDot animate={animate} />
            {campaign.status_detail ?? "Finding businesses"}
          </span>
        </div>
      )
    case "researching": {
      const eta = formatEta(campaign.eta_seconds)
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="inline-flex items-center gap-1.5 text-ui text-foreground">
            <WorkingDot animate={animate} />
            Researching
          </span>
          <Meter
            kind="progress"
            label={`Research progress for ${campaign.name}`}
            showLabel={false}
            value={Math.min(drafted, target)}
            max={target}
            valueText={`${Math.min(drafted, target)} of ${campaign.lead_target} ready`}
            size="sm"
            barClassName="w-20 flex-none"
            className="pl-5.5"
          />
          {eta && (
            <span className="pl-5.5 text-meta text-ink-secondary">
              {eta[0].toUpperCase() + eta.slice(1)}
            </span>
          )}
        </div>
      )
    }
    case "paused":
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-ui font-medium text-info">
            <CirclePauseIcon aria-hidden="true" className="size-4 shrink-0" />
            Paused
          </span>
          <span className="pl-5.5 text-meta text-ink-secondary">
            {campaign.status_detail ??
              "Research paused. We'll resume automatically, and nothing is lost."}
          </span>
        </div>
      )
    case "failed":
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-ui font-medium text-ink-secondary">
            <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
            Couldn't finish
          </span>
          {campaign.status_detail && (
            <span className="pl-5.5 text-meta text-ink-secondary">
              {campaign.status_detail}
            </span>
          )}
        </div>
      )
    case "done":
    default:
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-ui font-medium text-success">
            <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" />
            Done
          </span>
          <span className="pl-5.5 text-meta text-ink-secondary">
            {plural(drafted, "draft")}
            {campaign.finished_at
              ? `, finished ${formatDate(campaign.finished_at)}`
              : ""}
          </span>
        </div>
      )
  }
}

/** One campaign as a list row; the whole row opens its review desk. */
export function CampaignRow({
  campaign,
  animate,
}: {
  campaign: CampaignSummary
  animate: boolean
}) {
  const counts = campaign.counts
  return (
    <li
      data-testid="campaign-row"
      className={cn(
        "group relative flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted sm:px-5",
        ROW_GRID,
        "xl:py-3"
      )}
    >
      <div className="min-w-0 space-y-0.5 pr-6 xl:pr-0">
        <Link
          to="/campaigns/$campaignId"
          params={{ campaignId: campaign.id }}
          search={{}}
          className="text-ui font-semibold text-foreground after:absolute after:inset-0 after:content-[''] hover:underline"
        >
          {campaign.name}
        </Link>
        <p className="text-meta text-ink-secondary">
          Created {formatDate(campaign.created_at)} ·{" "}
          {plural(campaign.lead_target, "business", "businesses")}
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8 xl:contents">
        <CampaignStatusLine campaign={campaign} animate={animate} />

        {/* Counts: columns with a shared header on wide screens, a sentence on narrow ones. */}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-ui text-ink-secondary md:justify-end md:pt-0.5 xl:contents">
          {COUNT_COLUMNS.map((column) => {
            const value = counts[column.key]
            return (
              <span
                key={column.key}
                data-count={column.key}
                className={cn(
                  "whitespace-nowrap xl:text-right",
                  value === 0 && "xl:text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    value > 0 ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {value}
                </span>
                <span className="xl:sr-only">
                  {" "}
                  {value === 1 ? column.one : column.many}
                </span>
                <span className="sr-only">,</span>
              </span>
            )
          })}
        </p>
      </div>

      <ChevronRightIcon
        aria-hidden="true"
        className="absolute top-4 right-3 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:right-4 xl:static"
      />
    </li>
  )
}
