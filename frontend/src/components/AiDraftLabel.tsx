import { Mark } from "@/components/Mark"
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { useAiName } from "@/hooks/use-account"
import type { EditorReport, Provenance } from "@/lib/api/types"
import { displayDomain, formatDateTime, plural } from "@/lib/format"
import { cn } from "@/lib/utils"

export interface AiDraftLabelProps {
  /** How the draft was made (pages, checks, model). Null while drafting. */
  provenance: Provenance | null
  /** The editor's checks, listed in the panel when present. */
  editor?: EditorReport | null
  /** The business's site, for the summary sentence. */
  website?: string | null
  className?: string
}

/**
 * The "AI" label from IBM Carbon for AI: marks AI-written content, and opens a
 * small panel explaining how it was made: which pages were read and when,
 * which checks passed, and which model wrote it (Provenance.model).
 */
export function AiDraftLabel({ provenance, editor, website, className }: AiDraftLabelProps) {
  const { name } = useAiName()
  const writer = name ?? "The AI"
  const pages = provenance?.pages ?? []
  return (
    <Popover>
      <PopoverTrigger
        data-slot="ai-label"
        className={cn(
          "inline-flex h-7 items-center gap-1.5 border border-ink px-2 text-meta transition-colors duration-(--dur-fast) hover:bg-tint data-popup-open:bg-tint",
          className
        )}
        aria-label="AI draft: how this email was made"
      >
        <span className="font-extrabold stretch-condensed">AI</span> <span>draft</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-88 max-w-[calc(100vw-2rem)] gap-3 p-4">
        <div className="space-y-1">
          <PopoverTitle className="text-ui font-bold">How this draft was made</PopoverTitle>
          <PopoverDescription className="text-ui">
            {writer} read {plural(pages.length, "page")}
            {website ? ` of ${displayDomain(website)}` : ""} and wrote this email.
            {provenance ? ` Its editor checked it: ${provenance.checks_passed} of ${provenance.checks_total} checks passed.` : ""}{" "}
            You decide whether it's sent.
          </PopoverDescription>
        </div>
        {pages.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="aside">Pages read</h3>
            <ul className="space-y-1">
              {pages.map((page) => (
                <li key={page.url} className="flex items-baseline gap-2 text-ui">
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate font-semibold underline decoration-1 underline-offset-[3px] hover:text-edge"
                  >
                    {page.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <span aria-hidden="true" className="leader" />
                  <span className="shrink-0 aside not-italic tabular-nums">
                    {formatDateTime(page.fetched_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {editor && editor.checks.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="aside">Checks</h3>
            <ul className="space-y-1">
              {editor.checks.map((check) => (
                <li key={check.key} className="flex items-center gap-2 text-ui">
                  {check.passed ? (
                    <Mark name="check" />
                  ) : (
                    <Mark name="asterisk" className="text-edge" />
                  )}
                  <span>{check.label}</span>
                  <span className="sr-only">{check.passed ? "passed" : "needs attention"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-hairline pt-3 text-meta">
          <dt className="italic">Model</dt>
          <dd className="font-medium break-all">{provenance?.model ?? "Not drafted yet"}</dd>
          {provenance?.drafted_at && (
            <>
              <dt className="italic">Drafted</dt>
              <dd>{formatDateTime(provenance.drafted_at)}</dd>
            </>
          )}
        </dl>
        <p className="aside">
          The fact numbers stay here. They never appear in the email you copy or open.
        </p>
      </PopoverContent>
    </Popover>
  )
}
