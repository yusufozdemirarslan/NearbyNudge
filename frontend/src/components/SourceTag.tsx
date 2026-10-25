import * as React from "react"
import { ArrowUpRightIcon, DatabaseIcon, FileTextIcon, ScaleIcon, SearchIcon } from "lucide-react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { useAiName } from "@/hooks/use-account"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

interface LinkedSourceProps {
  /** The business's own site, or a page the AI's web search returned. */
  kind: "site" | "search"
  /** "About page". */
  label: string
  /** When the page was read (shown as "Oct 24"). */
  date?: string | null
  /** Link that jumps to the quote (`#:~:text=`), else the page URL. */
  href: string | null
  /** The exact supporting quote, shown on hover and keyboard focus. */
  quote?: string | null
  /** False when our code couldn't find the quote in the saved page. */
  quoteFound?: boolean
  className?: string
}

interface ListingSourceProps {
  /** Open listings data, shown with the dataset and month; never linked. */
  kind: "listing"
  /** "Business listing (Overture Maps, Oct 2026)". */
  label: string
  className?: string
}

interface JudgmentSourceProps {
  /** The AI's own judgment. Labelled as such and never styled like a citation. */
  kind: "judgment"
  className?: string
}

export type SourceTagProps = LinkedSourceProps | ListingSourceProps | JudgmentSourceProps

const base =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-sm px-1.5 text-meta whitespace-nowrap align-middle"

/**
 * Where a fact came from, in three visibly different styles (brief §3.4):
 * - site/search: a linked tag ("About page, Oct 24") that opens the page at
 *   the quoted passage; hovering or focusing it shows the exact quote. The
 *   preview stays open while hovered and closes with Esc (WCAG 1.4.13).
 * - listing: the dataset and month, not linked.
 * - judgment: "Claude's judgment" (the AI's name from /api/status), dashed and
 *   unlinked so it never looks like a cited fact.
 */
export function SourceTag(props: SourceTagProps) {
  const { label: aiLabel } = useAiName()
  const quoteId = React.useId()

  if (props.kind === "judgment") {
    return (
      <span
        data-slot="source-tag"
        data-kind="judgment"
        className={cn(base, "border border-dashed border-[color-mix(in_srgb,var(--ink-secondary)_55%,transparent)] text-ink-secondary", props.className)}
      >
        <ScaleIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{aiLabel("judgment")}</span>
      </span>
    )
  }

  if (props.kind === "listing") {
    return (
      <span
        data-slot="source-tag"
        data-kind="listing"
        className={cn(base, "bg-muted text-ink-secondary", props.className)}
      >
        <DatabaseIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{props.label}</span>
      </span>
    )
  }

  const { kind, label, date, href, quote, quoteFound = true, className } = props
  const Icon = kind === "search" ? SearchIcon : FileTextIcon
  const text = date ? `${label}, ${formatDate(date)}` : label
  const tagClass = cn(
    base,
    "border border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-card font-medium text-primary transition-colors hover:border-primary hover:bg-accent data-popup-open:border-primary data-popup-open:bg-accent",
    className
  )

  if (!href) {
    return (
      <span data-slot="source-tag" data-kind={kind} className={tagClass}>
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{text}</span>
        {quote && <span className="sr-only">. Quote: “{quote}”</span>}
      </span>
    )
  }

  return (
    <>
      <HoverCard>
        <HoverCardTrigger
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          delay={250}
          closeDelay={250}
          data-slot="source-tag"
          data-kind={kind}
          aria-describedby={quote ? quoteId : undefined}
          className={tagClass}
        >
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{text}</span>
          <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
          <span className="sr-only"> (opens in a new tab)</span>
        </HoverCardTrigger>
        {quote && (
          <HoverCardContent side="top" align="start" sideOffset={6} className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-3">
            <p className="text-meta text-muted-foreground">
              {kind === "search" ? "Quote from a web page" : `Quote from the ${label}`}
              {date ? `, read ${formatDate(date)}` : ""}
            </p>
            <blockquote className="border-l-2 border-primary pl-3 text-ui text-foreground">“{quote}”</blockquote>
            {!quoteFound && (
              <p className="text-meta text-warning">We couldn't find this exact quote in our saved copy of the page.</p>
            )}
            <p className="text-meta text-muted-foreground">Opens the page at this passage.</p>
          </HoverCardContent>
        )}
      </HoverCard>
      {quote && (
        <span id={quoteId} hidden>
          Quote: “{quote}”
        </span>
      )}
    </>
  )
}
