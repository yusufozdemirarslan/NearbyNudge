import { CheckIcon, FileTextIcon, XIcon } from "lucide-react"
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
          "inline-flex h-6 items-center gap-1 rounded-sm border border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-card px-1.5 text-meta text-foreground transition-colors hover:bg-accent data-popup-open:bg-accent",
          className
        )}
        aria-label="AI draft: how this email was made"
      >
        <span className="font-semibold text-primary">AI</span> <span>draft</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] max-w-[calc(100vw-2rem)] gap-3 p-4">
        <div className="space-y-1">
          <PopoverTitle className="text-ui font-semibold">How this draft was made</PopoverTitle>
          <PopoverDescription className="text-ui text-ink-secondary">
            {writer} read {plural(pages.length, "page")}
            {website ? ` of ${displayDomain(website)}` : ""} and wrote this email.
            {provenance ? ` Its editor checked it: ${provenance.checks_passed} of ${provenance.checks_total} checks passed.` : ""}{" "}
            You decide whether it's sent.
          </PopoverDescription>
        </div>
        {pages.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-meta font-medium text-muted-foreground">Pages read</h3>
            <ul className="space-y-1">
              {pages.map((page) => (
                <li key={page.url} className="flex items-center gap-2 text-ui">
                  <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate text-primary underline-offset-2 hover:underline"
                  >
                    {page.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <span className="ml-auto shrink-0 text-meta text-muted-foreground">
                    {formatDateTime(page.fetched_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {editor && editor.checks.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-meta font-medium text-muted-foreground">Checks</h3>
            <ul className="space-y-1">
              {editor.checks.map((check) => (
                <li key={check.key} className="flex items-center gap-2 text-ui">
                  {check.passed ? (
                    <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-success" />
                  ) : (
                    <XIcon aria-hidden="true" className="size-4 shrink-0 text-warning" />
                  )}
                  <span>{check.label}</span>
                  <span className="sr-only">{check.passed ? "passed" : "needs attention"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-meta">
          <dt className="text-muted-foreground">Model</dt>
          <dd className="font-medium break-all">{provenance?.model ?? "Not drafted yet"}</dd>
          {provenance?.drafted_at && (
            <>
              <dt className="text-muted-foreground">Drafted</dt>
              <dd>{formatDateTime(provenance.drafted_at)}</dd>
            </>
          )}
        </dl>
        <p className="text-meta text-muted-foreground">
          The fact numbers stay here. They never appear in the email you copy or open.
        </p>
      </PopoverContent>
    </Popover>
  )
}
