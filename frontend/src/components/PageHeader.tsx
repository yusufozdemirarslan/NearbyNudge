import { cn } from "@/lib/utils"

export interface PageHeaderProps {
  /** The page's running head. Rendered as the page's h1, set in condensed caps. */
  title: React.ReactNode
  /** One plain sentence under the rule. */
  description?: React.ReactNode
  /** Buttons or one key fact on the right of the running head. */
  actions?: React.ReactNode
  /** Extra content under the description (meters, filters). */
  children?: React.ReactNode
  className?: string
}

/**
 * The running head every page opens with: the h1 in condensed black caps over
 * a heavy ink rule, its actions on the right, one sentence beneath.
 */
export function PageHeader({ title, description, actions, children, className }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-3 pb-8", className)}>
      {/* The head never splits a word to make room: on a narrow phone the actions drop
          under it, still above the rule. Only a word wider than the page itself is broken. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-(length:--rule-heavy) border-ink pb-2 sm:gap-x-6">
        <h1 className="running-head min-w-[min(100%,min-content)] flex-1 [overflow-wrap:break-word]">{title}</h1>
        {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 pb-1">{actions}</div>}
      </div>
      {description && <p className="max-w-measure text-ui">{description}</p>}
      {children}
    </header>
  )
}
