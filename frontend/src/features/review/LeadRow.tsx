import * as React from "react"
import { Link } from "@tanstack/react-router"
import { FileInputIcon, MailIcon, PhoneOffIcon } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { FitBadge } from "@/components/FitBadge"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { StatusBadge, isInProgress } from "@/components/StatusBadge"
import type { ContactKind, LeadSummary } from "@/lib/api/types"
import { formatDistance } from "@/lib/format"
import { cn } from "@/lib/utils"

const CONTACT: Record<ContactKind, { label: string; icon: typeof MailIcon }> = {
  email: { label: "Email", icon: MailIcon },
  form: { label: "Form", icon: FileInputIcon },
  none: { label: "No contact", icon: PhoneOffIcon },
}

export interface LeadRowProps {
  lead: LeadSummary
  selected: boolean
  checked: boolean
  /** 0 for the row that takes Tab focus (roving tabindex), -1 otherwise. */
  tabIndex: 0 | -1
  compact: boolean
  /** Arrived after the list was shown: soft teal tint fading over ~1 s. */
  fresh: boolean
  /** Live updates paused: the working dot stops. */
  still: boolean
  onToggleChecked: (checked: boolean) => void
  onOpen: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLAnchorElement>) => void
}

/** One lead in the review desk's list. The whole row is one link. */
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
  const contact = lead.contact_kind ? CONTACT[lead.contact_kind] : null
  const working = isInProgress(lead.status)
  const status = (
    <StatusBadge
      status={lead.status}
      stageLabel={lead.stage_label}
      step={lead.step}
      animate={!still}
      className="min-w-0"
    />
  )
  return (
    <li
      data-lead-id={lead.id}
      data-selected={selected || undefined}
      className={cn(
        "group/row relative flex items-stretch border-b border-border/70 transition-colors duration-150",
        compact ? "h-8" : "h-10",
        selected ? "bg-accent" : "hover:bg-muted/70",
        flash && !selected && "animate-row-new motion-reduce:animate-none"
      )}
    >
      {/* Selected row: a 3px teal edge (the tint alone measures 1.1:1). */}
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-[3px]", selected ? "bg-primary" : "bg-transparent")}
      />
      <div className="flex w-8 shrink-0 items-center justify-center pl-1">
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onToggleChecked(Boolean(value))}
          tabIndex={-1}
          aria-label={`Select ${lead.name}`}
          className="size-4"
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
          "focus-inset flex min-w-0 flex-1 items-center gap-2.5 pr-3 outline-none",
          compact ? "py-0" : "py-[3px]"
        )}
      >
        <span className="flex w-6 shrink-0 justify-end">
          <FitBadge score={lead.fit_score} label={lead.fit_label} variant="list" />
        </span>
        {compact ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className={cn("truncate text-list font-medium", working && "text-ink-secondary")}>{lead.name}</span>
            <span className="ml-auto shrink-0">{status}</span>
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-col justify-center">
            <span className={cn("truncate text-list font-medium", working && "text-ink-secondary")}>{lead.name}</span>
            <span className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
              <span className="shrink-0 tabular-nums">{formatDistance(lead.distance_mi)}</span>
              {/* The contact appears once research finds it; a lead whose research ended without it shows none. */}
              {(contact || working) && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  {contact ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <contact.icon aria-hidden="true" className="size-3.5" />
                      <span>{contact.label}</span>
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center">
                      <PlaceholderBar width={34} />
                      <span className="sr-only">Contact not found yet</span>
                    </span>
                  )}
                </>
              )}
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
              {status}
            </span>
          </span>
        )}
      </Link>
    </li>
  )
})
