import { cn } from "@/lib/utils"

export interface EmptyStateProps {
  /** Short, plain head: "No leads need review". */
  title: string
  /** Why it's empty and what happens next: "3 are still being researched." */
  description?: React.ReactNode
  /** The action that fills it (a button or link). */
  action?: React.ReactNode
  /** "page" sits in a page or pane; "inline" fits inside a panel or list. */
  size?: "page" | "inline"
  className?: string
}

/**
 * An empty space that says what will fill it and offers the way there: a
 * condensed head, one sentence, one action. No icon tile. Never use it to
 * say "No leads" while research is still running.
 */
export function EmptyState({ title, description, action, size = "page", className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-start gap-2 text-left",
        size === "page" ? "mx-auto w-full max-w-md px-6 py-16" : "px-4 py-8",
        className
      )}
    >
      <p className={size === "page" ? "section-head" : "text-ui font-bold"}>{title}</p>
      {description && <div className="max-w-measure text-ui">{description}</div>}
      {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}
