import { ChevronDownIcon, ChevronLeftIcon, ChevronUpIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FitBadge } from "@/components/FitBadge"
import { KeyHint } from "@/components/KeyHint"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { SourceTag } from "@/components/SourceTag"
import { StatusBadge } from "@/components/StatusBadge"
import type { Lead, LeadSummary } from "@/lib/api/types"
import { displayDomain, fitLabel, formatDistance } from "@/lib/format"
import { cn } from "@/lib/utils"

export interface LeadHeaderProps {
  summary: LeadSummary
  lead: Lead | undefined
  onPrev: (() => void) | null
  onNext: (() => void) | null
  /** Phone layout: show "All leads" to return to the list. */
  onBack?: () => void
  livePaused: boolean
  className?: string
}

/**
 * The open entry, set like a directory listing: the name in condensed caps
 * with a leader to its fit, then the listing in short sentences (status, fit,
 * category, distance; address, phone, website) and why it's worth writing to.
 */
export function LeadHeader({ summary, lead, onPrev, onNext, onBack, livePaused, className }: LeadHeaderProps) {
  const reason = lead?.fit_reason
  const fitWord = summary.fit_score === null ? null : (summary.fit_label ?? fitLabel(summary.fit_score))
  const nav = (
    <div className="flex shrink-0 items-center gap-1">
      <NavButton label="Previous lead" keys="K" onClick={onPrev} icon={<ChevronUpIcon aria-hidden="true" />} />
      <NavButton label="Next lead" keys="J" onClick={onNext} icon={<ChevronDownIcon aria-hidden="true" />} />
    </div>
  )
  return (
    <header data-slot="lead-header" className={cn("border-b border-ink px-4 pt-5 pb-4 sm:px-6 xl:px-8", className)}>
      {onBack && (
        // Phones: back and previous/next share the top line, so the name gets the full width.
        <div className="mb-2 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3">
            <ChevronLeftIcon aria-hidden="true" />
            All leads
          </Button>
          {nav}
        </div>
      )}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-baseline gap-3">
            <h2 className="min-w-0 text-title uppercase stretch-condensed xl:text-display">{summary.name}</h2>
            <span aria-hidden="true" className="leader max-sm:hidden" />
            {summary.status === "failed" && summary.fit_score === null ? (
              <span className="shrink-0 text-ui italic">Not scored</span>
            ) : (
              <FitBadge
                score={summary.fit_score}
                label={summary.fit_label}
                variant="display"
                className="text-title xl:text-display"
              />
            )}
          </div>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ui">
            <StatusBadge
              status={summary.status}
              stageLabel={summary.stage_label}
              step={summary.step}
              date={lead?.sent_at}
              replyOutcome={lead?.reply_outcome}
              size="md"
              animate={!livePaused}
            />
            {fitWord && <span>{fitWord} fit.</span>}
            <span>{summary.category_label}.</span>
            <span className="tabular-nums">{formatDistance(summary.distance_mi)}.</span>
          </p>
          {lead ? (
            <p className="text-ui">
              <span>{lead.address}.</span>
              {lead.phone && (
                <>
                  {" "}
                  <a
                    href={`tel:${lead.phone.replace(/[^\d+]/gu, "")}`}
                    className="tabular-nums whitespace-nowrap underline-offset-4 hover:underline"
                  >
                    {lead.phone}
                  </a>
                  .
                </>
              )}
              {lead.website && (
                <>
                  {" "}
                  <a
                    href={lead.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline underline-offset-3 hover:text-edge"
                  >
                    {displayDomain(lead.website)}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </>
              )}
            </p>
          ) : (
            <p className="flex items-center gap-3" aria-hidden="true">
              <PlaceholderBar width={220} />
              <PlaceholderBar width={110} />
            </p>
          )}
          {reason ? (
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-ui">
              <span>
                <span className="font-bold">Why: </span>
                {reason}
              </span>
              <SourceTag kind="judgment" />
            </p>
          ) : lead && summary.fit_score === null && summary.status !== "failed" ? (
            <p className="aside">The fit and the reason appear after the hook is chosen.</p>
          ) : null}
        </div>
        {!onBack && <div className="pt-1">{nav}</div>}
      </div>
    </header>
  )
}

function NavButton({
  label,
  keys,
  onClick,
  icon,
}: {
  label: string
  keys: string
  onClick: (() => void) | null
  icon: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={label}
            aria-keyshortcuts={keys}
            disabled={!onClick}
            onClick={onClick ?? undefined}
            className="disabled:border-transparent"
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} <KeyHint keys={keys} />
      </TooltipContent>
    </Tooltip>
  )
}
