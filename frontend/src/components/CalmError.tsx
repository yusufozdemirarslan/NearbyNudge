import { Button } from "@/components/ui/button"
import { isApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"

export interface CalmErrorProps {
  /** Plain head, e.g. "We couldn't load this campaign". */
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
 * An error set as a boxed notice: a red rule across the top (it needs you), a
 * condensed head, what happened in plain words and the way forward. Errors
 * that block the user are announced (role="alert").
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
        "border border-t-(length:--rule-heavy) border-ink border-t-edge bg-paper text-left",
        size === "panel" ? "mx-auto my-10 max-w-md p-6" : "p-4",
        className
      )}
    >
      <p className={size === "panel" ? "section-head" : "text-ui font-bold"}>{title}</p>
      <p className="mt-2 text-ui">{text}</p>
      {(onRetry || action) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  )
}
