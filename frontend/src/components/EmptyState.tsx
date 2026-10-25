import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface EmptyStateProps {
  /** Lucide icon shown in a quiet tile. */
  icon?: LucideIcon
  /** Short, plain title: "No leads need review". */
  title: string
  /** Explain why it's empty and what happens next: "3 are still being researched." */
  description?: React.ReactNode
  /** A way forward (a button or link). */
  action?: React.ReactNode
  /** "page" centres it in a page; "inline" fits inside a panel or list. */
  size?: "page" | "inline"
  className?: string
}

/**
 * An empty view that explains itself and offers a way forward. Never use it
 * to say "No leads" while research is still running (brief §3.7).
 */
export function EmptyState({ icon: Icon, title, description, action, size = "page", className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center text-center",
        size === "page" ? "gap-3 px-6 py-16" : "gap-2 px-4 py-8",
        className
      )}
    >
      {Icon && (
        <span className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted text-ink-secondary">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      )}
      <p className={cn("font-semibold text-foreground", size === "page" ? "text-pane-title" : "text-ui")}>{title}</p>
      {description && <div className="max-w-[44ch] text-ui text-ink-secondary">{description}</div>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}
