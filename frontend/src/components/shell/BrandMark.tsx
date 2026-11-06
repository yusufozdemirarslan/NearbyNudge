import { cn } from "@/lib/utils"

export interface OneStepMarkProps {
  /** Pixels; multiples of 16 keep the squares on whole pixels. */
  size?: number
  /** Give it a name only where the mark stands for NearbyNudge alone; beside the name it is decorative. */
  label?: string
  /** One ink: the small square takes the ink too. */
  monochrome?: boolean
  className?: string
}

/**
 * One Step, the NearbyNudge symbol (brand concept 04): two large squares for nearby places and
 * a small displaced square, the measured nudge, in edge red. The approved 16-unit drawing, exactly;
 * its fills read --nn-ink and --nn-edge, so it follows the theme the app applies.
 */
export function OneStepMark({ size = 32, label, monochrome = false, className }: OneStepMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      focusable="false"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-slot="brand-mark"
      className={cn("nn-mark shrink-0", className)}
    >
      <rect x="1" y="1" width="6" height="6" fill="var(--nn-ink)" />
      <rect x="9" y="9" width="6" height="6" fill="var(--nn-ink)" />
      <rect x="9" y="3" width="3" height="3" fill={monochrome ? "var(--nn-ink)" : "var(--nn-edge)"} />
    </svg>
  )
}

/**
 * The NearbyNudge identity: the One Step mark, then the name set as a running head
 * (Archivo 800 at 62.5% width, caps). The mark is decorative beside the readable name.
 * "md" is the masthead's 32px mark, 12px gap and 28px name; "sm" is the same at half size.
 */
export function BrandMark({
  withName = true,
  size = "md",
  className,
  nameClassName,
}: {
  withName?: boolean
  size?: "md" | "sm"
  className?: string
  /** For a placement that hides the name on narrow screens; the surrounding link keeps its name. */
  nameClassName?: string
}) {
  const small = size === "sm"
  return (
    <span className={cn("inline-flex items-center text-ink", small ? "gap-1.5" : "gap-3", className)} data-slot="brand">
      <OneStepMark size={small ? 16 : 32} />
      {withName && (
        <span className={cn("brand-name whitespace-nowrap", small && "[--brand-name-size:14px]", nameClassName)}>
          NearbyNudge
        </span>
      )}
    </span>
  )
}
