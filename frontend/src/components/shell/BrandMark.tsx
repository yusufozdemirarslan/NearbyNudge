import { cn } from "@/lib/utils"

/**
 * The NearbyNudge mark: a red die-cut tab (the directory's thumb index) and the
 * name set as a running head in condensed black caps.
 */
export function BrandMark({ withName = true, className }: { withName?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 14 22" aria-hidden="true" className="h-5.5 w-3.5 shrink-0 fill-edge">
        <path d="M0 0h4a10 10 0 0 1 10 10v2A10 10 0 0 1 4 22H0z" />
      </svg>
      {withName && <span className="text-head leading-none uppercase stretch-condensed">NearbyNudge</span>}
    </span>
  )
}
