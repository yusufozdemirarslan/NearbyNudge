import * as React from "react"
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

const base = "inline-flex max-w-full min-w-0 items-baseline gap-1 text-meta whitespace-nowrap"

/**
 * Where a fact came from, set like a directory footnote, in three visibly
 * different styles:
 * - site/search: an underlined reference ("About page, Oct 24") that opens the
 *   page at the quoted passage; hovering or focusing it shows the exact quote.
 *   The preview stays open while hovered and closes with Esc (WCAG 1.4.13).
 * - listing: the dataset and month in italic, not linked.
 * - judgment: "Claude's judgment" in italic with a dashed underline, unlinked,
 *   so it never looks like a cited fact.
 */
export function SourceTag(props: SourceTagProps) {
  const { label: aiLabel } = useAiName()
  const quoteId = React.useId()

  if (props.kind === "judgment") {
    return (
      <span
        data-slot="source-tag"
        data-kind="judgment"
        className={cn(base, "italic underline decoration-dashed decoration-1 underline-offset-4", props.className)}
      >
        <span className="truncate">{aiLabel("judgment")}</span>
      </span>
    )
  }

  if (props.kind === "listing") {
    return (
      <span data-slot="source-tag" data-kind="listing" className={cn(base, "italic", props.className)}>
        <span className="truncate">{props.label}</span>
      </span>
    )
  }

  const { kind, label, date, href, quote, quoteFound = true, className } = props
  const text = date ? `${label}, ${formatDate(date)}` : label
  const tagClass = cn(
    base,
    "font-semibold underline decoration-1 underline-offset-3 transition-colors duration-(--dur-fast) hover:text-edge data-popup-open:text-edge",
    className
  )

  if (!href) {
    return (
      <span data-slot="source-tag" data-kind={kind} className={tagClass}>
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
          <span className="truncate">{text}</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </HoverCardTrigger>
        {quote && (
          <HoverCardContent side="top" align="start" sideOffset={6} className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-4">
            <p className="aside">
              {kind === "search" ? "Quote from a web page" : `Quote from the ${label}`}
              {date ? `, read ${formatDate(date)}` : ""}
            </p>
            <blockquote className="text-body italic">“{quote}”</blockquote>
            {!quoteFound && (
              <p className="text-meta font-semibold text-edge">We couldn't find this exact quote in our saved copy of the page.</p>
            )}
            <p className="aside">Opens the page at this passage.</p>
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
