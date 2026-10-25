import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/*
 * NearbyNudge buttons (Direction A): 6px corners, 14/20 labels, Lucide icons
 * at 20px (16px in the small sizes) with a 1.75 stroke. Every size keeps the
 * target at or above 24 × 24 px (WCAG 2.5.8); phone layouts use `lg` (40px+).
 * Destructive buttons use dark text in dark mode (white measures 2.4:1 there).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent bg-clip-padding text-ui font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-150 outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary),var(--foreground)_14%)]",
        outline:
          "border-[color-mix(in_srgb,var(--input)_55%,transparent)] bg-card text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted dark:hover:bg-accent/60",
        destructive:
          "bg-destructive text-primary-foreground hover:bg-[color-mix(in_srgb,var(--destructive),var(--foreground)_14%)]",
        "destructive-soft":
          "bg-danger-tint text-destructive hover:bg-[color-mix(in_srgb,var(--danger-tint),var(--destructive)_12%)]",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2 text-meta [&_svg:not([class*='size-'])]:size-4",
        sm: "h-8 gap-1.5 px-2.5 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-11 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * Button built on Base UI. Pass `render` to render a link or another element
 * with button styles. Use `aria-keyshortcuts` with a `KeyHint` child when the
 * button has a keyboard shortcut.
 */
function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
