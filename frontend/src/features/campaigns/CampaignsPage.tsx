import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CirclePauseIcon, PlusIcon, RotateCwIcon } from "lucide-react"
import { CalmError } from "@/components/CalmError"
import { Meter } from "@/components/Meter"
import { PageContainer } from "@/components/PageContainer"
import { PageHeader } from "@/components/PageHeader"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { Button, buttonVariants } from "@/components/ui/button"
import { useAccount, useAiName, usePreferences } from "@/hooks/use-account"
import { useAnnounce } from "@/hooks/use-announce"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useReducedMotion } from "@/hooks/use-media-query"
import { campaignsQuery } from "@/lib/api/queries"
import type { CampaignSummary } from "@/lib/api/types"
import { plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { NewCampaignForm } from "@/features/new-campaign/NewCampaignForm"
import {
  COUNT_COLUMNS,
  CampaignRow,
  ROW_GRID,
  draftedCount,
  isRunning,
} from "./CampaignRow"

const RUNNING_POLL_MS = 4000
const PAUSED_POLL_MS = 15000

function pollInterval(
  campaigns: CampaignSummary[] | undefined,
  live: boolean
): number | false {
  if (!live || !campaigns) return false
  if (campaigns.some(isRunning)) return RUNNING_POLL_MS
  if (campaigns.some((campaign) => campaign.status === "paused"))
    return PAUSED_POLL_MS
  return false
}

/** Today's sends and this month's leads, in words and bars. */
function UsageMeters() {
  const { data: account } = useAccount()
  if (!account) return <PlaceholderBar width={320} />
  const { sending, usage } = account
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
      <Meter
        label="Sent today"
        value={sending.sent_today}
        max={sending.daily_cap}
        tone={sending.sent_today >= sending.daily_cap ? "warning" : "default"}
        barClassName="w-28 flex-none"
      />
      <Meter
        label={`Leads in ${usage.month_label.split(" ")[0]}`}
        value={usage.used}
        max={usage.limit}
        tone={usage.used >= usage.limit ? "warning" : "default"}
        barClassName="w-28 flex-none"
      />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div aria-busy="true" className="rounded-xl border bg-card">
      <span className="sr-only">Loading your campaigns</span>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex flex-col gap-2 border-b px-5 py-4 last:border-b-0"
        >
          <PlaceholderBar width="16rem" />
          <PlaceholderBar width="7rem" className="text-meta" />
        </div>
      ))}
    </div>
  )
}

/** Says when a campaign finishes while the page is open (polite, once). */
function useFinishAnnouncements(campaigns: CampaignSummary[] | undefined) {
  const announce = useAnnounce()
  const previous = React.useRef(new Map<string, CampaignSummary["status"]>())
  React.useEffect(() => {
    if (!campaigns) return
    for (const campaign of campaigns) {
      const before = previous.current.get(campaign.id)
      if (
        before &&
        before !== campaign.status &&
        (before === "finding" || before === "researching")
      ) {
        if (campaign.status === "done") {
          announce(
            `${campaign.name} is done: ${plural(draftedCount(campaign.counts), "draft")} to review.`
          )
        } else if (campaign.status === "paused") {
          announce(
            `${campaign.name} is paused. We'll resume automatically, and nothing is lost.`
          )
        }
      }
      previous.current.set(campaign.id, campaign.status)
    }
  }, [announce, campaigns])
}

/**
 * Campaigns home (DB1, DB5): today's sending meter and monthly usage, then
 * every campaign as a row with its status, progress and counts. A first-time
 * user sees the New campaign form here instead of an empty table (brief 3.4).
 */
export function CampaignsPage() {
  useDocumentTitle("Campaigns")
  const preferences = usePreferences()
  const live = preferences.live_updates
  const reducedMotion = useReducedMotion()
  const { name: aiName } = useAiName()
  const campaigns = useQuery({
    ...campaignsQuery(),
    refetchInterval: (query) => pollInterval(query.state.data, live),
  })
  useFinishAnnouncements(campaigns.data)

  const list = campaigns.data ?? []
  const empty = campaigns.isSuccess && list.length === 0
  const anyRunning = list.some(isRunning)

  return (
    <PageContainer>
      <PageHeader
        title="Campaigns"
        description={
          empty
            ? undefined
            : "Each campaign finds nearby businesses and drafts an email for each one. Open a campaign to review its drafts."
        }
        actions={
          !empty && campaigns.isSuccess ? (
            <Link to="/campaigns/new" className={buttonVariants()}>
              <PlusIcon aria-hidden="true" />
              New campaign
            </Link>
          ) : undefined
        }
      >
        <UsageMeters />
      </PageHeader>

      {campaigns.isPending && <ListSkeleton />}

      {campaigns.isError && (
        <CalmError
          title="We couldn't load your campaigns"
          error={campaigns.error}
          onRetry={() => void campaigns.refetch()}
        />
      )}

      {empty && (
        <section
          aria-labelledby="first-campaign-title"
          className="flex flex-col gap-5"
        >
          <div className="space-y-1">
            <h2
              id="first-campaign-title"
              className="text-pane-title font-semibold text-foreground"
            >
              Start your first campaign
            </h2>
            <p className="max-w-[68ch] text-ui text-ink-secondary">
              Tell us where you sell, who you sell to and what you offer.{" "}
              {aiName ?? "The AI"} restates the plan, then finds nearby
              businesses and drafts an email for each one. You review every
              draft; nothing is sent for you.
            </p>
          </div>
          <div className="max-w-3xl">
            <NewCampaignForm headingLevel={3} />
          </div>
        </section>
      )}

      {campaigns.isSuccess && list.length > 0 && (
        <section
          aria-labelledby="campaign-list-title"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2
              id="campaign-list-title"
              className="text-ui font-semibold text-foreground"
            >
              {plural(list.length, "campaign")}
            </h2>
            {!live && anyRunning && (
              <div className="flex flex-wrap items-center gap-2 text-ui text-ink-secondary">
                <CirclePauseIcon
                  aria-hidden="true"
                  className="size-4 text-info"
                />
                <span>
                  Live updates are paused, so this list doesn't refresh on its
                  own.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void campaigns.refetch()}
                >
                  <RotateCwIcon aria-hidden="true" />
                  Refresh
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border bg-card">
            <div
              aria-hidden="true"
              className={cn(
                "hidden border-b bg-muted px-5 py-2 text-meta font-medium text-ink-secondary xl:grid",
                ROW_GRID
              )}
            >
              <span>Campaign</span>
              <span>Status</span>
              {COUNT_COLUMNS.map((column) => (
                <span key={column.key} className="text-right">
                  {column.label}
                </span>
              ))}
              <span />
            </div>
            <ul aria-labelledby="campaign-list-title" className="divide-y">
              {list.map((campaign) => (
                <CampaignRow
                  key={campaign.id}
                  campaign={campaign}
                  animate={live && !reducedMotion}
                />
              ))}
            </ul>
          </div>
        </section>
      )}
    </PageContainer>
  )
}
