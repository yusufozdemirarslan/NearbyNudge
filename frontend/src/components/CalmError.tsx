import { CircleAlertIcon, RotateCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"

export interface CalmErrorProps {
  /** Plain title, e.g. "We couldn't load this campaign". */
  title?: string
  /** The error (its ApiError message is shown) or your own sentence. */
  error?: unknown
  message?: string
  /** Offer a retry; most errors should. */
  onRetry?: () => void
  retryLabel?: string
  /** Another way forward (a link back, a different action). */
  action?: React.ReactNode
  /** "panel" fills a pane; "inline" sits inside a section. */
  size?: "panel" | "inline"
  className?: string
}

/**
 * A calm error with a way forward. No red screens: it uses the page's own
 * colors, says what happened in plain words and offers what to do next.
 * Errors that block the user are announced (role="alert").
 */
export function CalmError({
  title = "We couldn't load this",
  error,
  message,
  onRetry,
  retryLabel = "Try again",
  action,
  size = "panel",
  className,
}: CalmErrorProps) {
  const text =
    message ??
    (isApiError(error) ? error.message : "Something went wrong on our side. Your work is saved; please try again.")
  return (
    <div
      role="alert"
      data-slot="calm-error"
      className={cn(
        "flex gap-3 rounded-xl border bg-card text-left",
        size === "panel" ? "mx-auto my-10 max-w-md p-5" : "p-4",
        className
      )}
    >
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-secondary" />
      <div className="min-w-0 space-y-2">
        <p className="text-ui font-semibold text-foreground">{title}</p>
        <p className="text-ui text-ink-secondary">{text}</p>
        {(onRetry || action) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCwIcon aria-hidden="true" />
                {retryLabel}
              </Button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  )
}
