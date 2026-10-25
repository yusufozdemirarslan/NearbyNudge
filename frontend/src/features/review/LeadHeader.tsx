import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, GlobeIcon, MapPinIcon, PhoneIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FitBadge } from "@/components/FitBadge"
import { KeyHint } from "@/components/KeyHint"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { SourceTag } from "@/components/SourceTag"
import { StatusBadge } from "@/components/StatusBadge"
import type { Lead, LeadSummary } from "@/lib/api/types"
import { displayDomain, formatDistance } from "@/lib/format"
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

/** The business: name, fit with its reason, distance, website, phone, address. */
export function LeadHeader({ summary, lead, onPrev, onNext, onBack, livePaused, className }: LeadHeaderProps) {
  const reason = lead?.fit_reason
  return (
    <header data-slot="lead-header" className={cn("border-b bg-background px-4 pt-3 pb-3 sm:px-6", className)}>
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-1 text-ink-secondary">
          <ArrowLeftIcon aria-hidden="true" />
          All leads
        </Button>
      )}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="text-pane-title font-semibold text-foreground">{summary.name}</h2>
            <FitBadge score={summary.fit_score} label={summary.fit_label} variant="header" />
            <span className="text-ui text-ink-secondary tabular-nums">{formatDistance(summary.distance_mi)}</span>
            <StatusBadge
              status={summary.status}
              stageLabel={summary.stage_label}
              step={summary.step}
              date={lead?.sent_at}
              replyOutcome={lead?.reply_outcome}
              size="md"
              animate={!livePaused}
            />
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui text-ink-secondary">
            <li>{summary.category_label}</li>
            {lead ? (
              <>
                {lead.website && (
                  <li>
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <GlobeIcon aria-hidden="true" className="size-4" />
                      {displayDomain(lead.website)}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                )}
                {lead.phone && (
                  <li>
                    <a href={`tel:${lead.phone.replace(/[^\d+]/gu, "")}`} className="inline-flex items-center gap-1.5 hover:underline">
                      <PhoneIcon aria-hidden="true" className="size-4" />
                      <span className="tabular-nums">{lead.phone}</span>
                    </a>
                  </li>
                )}
                <li className="inline-flex min-w-0 items-center gap-1.5">
                  <MapPinIcon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="truncate">{lead.address}</span>
                </li>
              </>
            ) : (
              <li className="flex items-center gap-3" aria-hidden="true">
                <PlaceholderBar width={140} />
                <PlaceholderBar width={110} />
              </li>
            )}
          </ul>
          {reason ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-foreground">
              <span>
                <span className="font-medium">Why: </span>
                {reason}
              </span>
              <SourceTag kind="judgment" />
            </p>
          ) : lead && summary.fit_score === null && summary.status !== "failed" ? (
            <p className="text-ui text-muted-foreground">The fit and the reason appear after the hook is chosen.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <NavButton label="Previous lead" keys="K" onClick={onPrev} icon={<ChevronUpIcon aria-hidden="true" />} />
          <NavButton label="Next lead" keys="J" onClick={onNext} icon={<ChevronDownIcon aria-hidden="true" />} />
        </div>
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
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-keyshortcuts={keys}
            disabled={!onClick}
            onClick={onClick ?? undefined}
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
