import * as React from "react"
import { Link } from "@tanstack/react-router"
import { Checkbox } from "@/components/ui/checkbox"
import { FitBadge } from "@/components/FitBadge"
import { Mark } from "@/components/Mark"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { StatusBadge, isInProgress } from "@/components/StatusBadge"
import type { ContactKind, LeadStatus, LeadSummary } from "@/lib/api/types"
import { formatDistance } from "@/lib/format"
import { cn } from "@/lib/utils"

const CONTACT: Record<ContactKind, string> = {
  email: "email on file",
  form: "contact form",
  none: "no contact",
}

/** The decisions a person makes. Reaching one of these files the entry. */
const FILED: LeadStatus[] = ["approved", "sent", "replied", "skipped", "dnc"]
const FILE_MS = 380

/**
 * Filing, the desk's one authored motion: when a decision lands, the old status
 * is struck through with a red rule, then the new status is set in its place.
 * Research updates and undos swap at once; so does everything under reduced
 * motion or while live updates are paused.
 */
function useFiling(status: LeadStatus, still: boolean) {
  const [shown, setShown] = React.useState(status)
  const [struck, setStruck] = React.useState(false)
  const [filed, setFiled] = React.useState(false)
  React.useEffect(() => {
    if (status === shown) {
      // Undone before the filing finished: drop the half-drawn strike.
      setStruck(false)
      return
    }
    const reduce = still || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!FILED.includes(status) || reduce) {
      setShown(status)
      setStruck(false)
      setFiled(false)
      return
    }
    setStruck(true)
    const timer = window.setTimeout(() => {
      setShown(status)
      setStruck(false)
      setFiled(true)
    }, FILE_MS)
    return () => window.clearTimeout(timer)
    // only a new status starts a filing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  return { shown, struck, filed }
}

export interface LeadRowProps {
  lead: LeadSummary
  selected: boolean
  checked: boolean
  /** 0 for the row that takes Tab focus (roving tabindex), -1 otherwise. */
  tabIndex: 0 | -1
  compact: boolean
  /** Arrived after the list was shown: a faint red wash that fades. */
  fresh: boolean
  /** Live updates paused: nothing moves. */
  still: boolean
  onToggleChecked: (checked: boolean) => void
  onOpen: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLAnchorElement>) => void
}

/**
 * One lead, set as a white-pages line: the name, a dot leader, the fit; then an
 * italic aside with the distance, the contact and the status. The open entry is
 * set in red with a pointer in the gutter. The whole line is one link.
 */
export const LeadRow = React.memo(function LeadRow({
  lead,
  selected,
  checked,
  tabIndex,
  compact,
  fresh,
  still,
  onToggleChecked,
  onOpen,
  onKeyDown,
}: LeadRowProps) {
  const [flash] = React.useState(fresh)
  const working = isInProgress(lead.status)
  const filing = useFiling(lead.status, still)
  const status = (
    <span className="relative inline-flex min-w-0">
      <StatusBadge
        key={filing.shown}
        status={filing.shown}
        stageLabel={lead.stage_label}
        step={lead.step}
        animate={!still}
        className={cn("min-w-0", filing.filed && "animate-tick")}
      />
      {filing.struck && (
        <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-0.5 origin-left animate-strike bg-edge" />
      )}
    </span>
  )
  const name = (
    <span
      className={cn(
        "truncate text-ui font-bold underline-offset-4 group-hover/row:underline",
        working && "font-semibold",
        selected && "text-edge"
      )}
    >
      {lead.name}
    </span>
  )
  return (
    <li
      data-lead-id={lead.id}
      data-selected={selected || undefined}
      className={cn(
        "group/row relative flex items-stretch border-b border-hairline transition-colors duration-(--dur-fast)",
        !selected && "hover:bg-tint",
        flash && !selected && "animate-row-new motion-reduce:animate-none"
      )}
    >
      <div className={cn("flex w-9 shrink-0 justify-center", compact ? "items-center" : "items-start pt-3")}>
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onToggleChecked(Boolean(value))}
          tabIndex={-1}
          aria-label={`Select ${lead.name}`}
        />
      </div>
      <Link
        to="/campaigns/$campaignId"
        params={{ campaignId: lead.campaign_id }}
        search={(prev) => ({ ...prev, lead: lead.id })}
        tabIndex={tabIndex}
        aria-current={selected ? "true" : undefined}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        data-row-link
        className={cn(
          "focus-inset flex min-w-0 flex-1 flex-col justify-center pr-4 outline-none",
          compact ? "h-9" : "gap-0.5 py-2.5"
        )}
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <Mark name="pointer" className={cn("size-2.5 shrink-0 self-center text-edge", !selected && "invisible")} />
          {name}
          <span aria-hidden="true" className="leader" />
          {compact && <span className="shrink-0">{status}</span>}
          <FitBadge score={lead.fit_score} label={lead.fit_label} variant="list" />
        </span>
        {!compact && (
          <span className="flex min-w-0 items-baseline gap-3 pl-4">
            <span className="flex min-w-0 items-baseline aside">
              <span className="shrink-0 tabular-nums not-italic">{formatDistance(lead.distance_mi)}</span>
              {/* The contact appears once research finds it; a lead whose research ended without it shows none. */}
              {lead.contact_kind ? (
                <span className="truncate">, {CONTACT[lead.contact_kind]}</span>
              ) : working ? (
                <>
                  <span className="mr-1">,</span>
                  <PlaceholderBar width={40} />
                  <span className="sr-only">Contact not found yet</span>
                </>
              ) : null}
            </span>
            <span className="ml-auto shrink-0">{status}</span>
          </span>
        )}
      </Link>
    </li>
  )
})
