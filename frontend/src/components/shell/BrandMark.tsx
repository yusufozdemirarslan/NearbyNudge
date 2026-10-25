import { cn } from "@/lib/utils"

/** The NearbyNudge mark (map pin on teal) with an optional wordmark. */
export function BrandMark({ withName = true, className }: { withName?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="size-7 shrink-0">
        <rect width="32" height="32" rx="7" className="fill-primary" />
        <path
          d="M16 6.5c-4.1 0-7.4 3.2-7.4 7.2 0 5.3 7.4 11.8 7.4 11.8s7.4-6.5 7.4-11.8c0-4-3.3-7.2-7.4-7.2Z"
          fill="none"
          className="stroke-primary-foreground"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="13.6" r="2.6" className="fill-primary-foreground" />
      </svg>
      {withName && (
        <span className="text-ui font-semibold tracking-[-0.01em] text-foreground">NearbyNudge</span>
      )}
    </span>
  )
}
