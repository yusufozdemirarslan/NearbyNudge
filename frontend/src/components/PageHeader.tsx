import { cn } from "@/lib/utils"

export interface PageHeaderProps {
  /** Page title (22/28, weight 650). Rendered as the page's h1. */
  title: React.ReactNode
  /** One plain sentence under the title. */
  description?: React.ReactNode
  /** Buttons on the right (wraps under the title on small screens). */
  actions?: React.ReactNode
  /** Extra content under the description (meters, filters). */
  children?: React.ReactNode
  className?: string
}

/** The standard page heading. Every page has exactly one. */
export function PageHeader({ title, description, actions, children, className }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-3 pb-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-page-title font-[650] tracking-[-0.01em] text-foreground">{title}</h1>
          {description && <p className="max-w-[68ch] text-ui text-ink-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}
