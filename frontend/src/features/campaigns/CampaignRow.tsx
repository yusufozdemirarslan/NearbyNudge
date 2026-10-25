import { Link } from "@tanstack/react-router"
import { Mark } from "@/components/Mark"
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
  "xl:grid xl:grid-cols-[minmax(0,1fr)_16rem_repeat(5,5.5rem)] xl:items-start xl:gap-x-4"

function WorkingDot({ animate }: { animate: boolean }) {
  return <Mark name="dot" className={cn(animate && "animate-working motion-reduce:animate-none")} />
}

const line = "inline-flex items-center gap-2 text-ui font-bold"

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
          <span className={line}>
            <WorkingDot animate={animate} />
            {campaign.status_detail ?? "Finding businesses"}
          </span>
        </div>
      )
    case "researching": {
      const eta = formatEta(campaign.eta_seconds)
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <span className={line}>
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
            className="pl-5"
          />
          {eta && (
            <span className="pl-5 aside">
              {eta[0].toUpperCase() + eta.slice(1)}
            </span>
          )}
        </div>
      )
    }
    case "paused":
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={line}>
            <Mark name="pause" />
            Paused
          </span>
          <span className="pl-5 aside">
            {campaign.status_detail ??
              "Research paused. We'll resume automatically, and nothing is lost."}
          </span>
        </div>
      )
    case "failed":
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={line}>
            <Mark name="cross" />
            Couldn't finish
          </span>
          {campaign.status_detail && (
            <span className="pl-5 aside">
              {campaign.status_detail}
            </span>
          )}
        </div>
      )
    case "done":
    default:
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={line}>
            <Mark name="check" />
            Done
          </span>
          <span className="pl-5 aside">
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
        "group relative -mx-3 flex flex-col gap-3 px-3 py-4 transition-colors duration-(--dur-fast) after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-hairline after:content-[''] hover:bg-tint",
        ROW_GRID
      )}
    >
      <div className="min-w-0 space-y-0.5 pr-6 xl:pr-0">
        <Link
          to="/campaigns/$campaignId"
          params={{ campaignId: campaign.id }}
          search={{}}
          className="text-lead font-bold underline-offset-4 after:absolute after:inset-0 after:content-[''] group-hover:underline"
        >
          {campaign.name}
        </Link>
        <p className="aside">
          Created {formatDate(campaign.created_at)}, {plural(campaign.lead_target, "business", "businesses")}.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8 xl:contents">
        <CampaignStatusLine campaign={campaign} animate={animate} />

        {/* Counts: columns with a shared header on wide screens, a sentence on narrow ones. */}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-ui md:justify-end md:pt-0.5 xl:contents">
          {COUNT_COLUMNS.map((column) => {
            const value = counts[column.key]
            const waiting = value > 0 && (column.key === "ready" || column.key === "needs_review")
            return (
              <span
                key={column.key}
                data-count={column.key}
                className={cn("whitespace-nowrap xl:text-right", waiting && "text-edge")}
              >
                <span
                  className={cn(
                    "tabular-nums xl:text-head xl:leading-none xl:stretch-condensed",
                    value > 0 ? "font-extrabold" : "font-normal"
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

    </li>
  )
}
