import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/*
 * Buttons, set like a directory: square, 2px ink rules, semibold labels.
 * Hover underlines the label; pressing nudges it down 1px (with `transform`, so it
 * adds to any `translate` used for placement); disabled turns the
 * rule dashed and the label soft. Every size keeps targets at or above
 * 24 × 24 px (WCAG 2.5.8); phone layouts use `lg` (44px).
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-2 border-2 border-transparent text-ui font-semibold whitespace-nowrap decoration-2 underline-offset-[5px] outline-none select-none transition-[color,background-color,border-color,transform] duration-(--dur-fast) ease-out active:[transform:translateY(1px)] disabled:pointer-events-none disabled:border-dashed disabled:text-ink-soft aria-disabled:pointer-events-none aria-disabled:border-dashed aria-disabled:text-ink-soft aria-invalid:border-edge [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default:
          "border-ink bg-ink text-paper hover:underline disabled:border-ink-soft disabled:bg-paper aria-disabled:border-ink-soft aria-disabled:bg-paper",
        outline: "border-ink bg-paper text-ink hover:underline aria-expanded:bg-tint disabled:border-ink-soft aria-disabled:border-ink-soft",
        secondary: "bg-tint text-ink hover:underline aria-expanded:underline",
        ghost: "text-ink hover:bg-tint aria-expanded:bg-tint",
        destructive:
          "border-edge bg-edge text-edge-ink hover:underline disabled:border-ink-soft disabled:bg-paper aria-disabled:border-ink-soft aria-disabled:bg-paper",
        "destructive-soft":
          "border-dashed border-edge bg-paper text-edge hover:underline disabled:border-ink-soft aria-disabled:border-ink-soft",
        link: "h-auto border-0 px-0 text-ink underline decoration-1 underline-offset-4 hover:text-edge",
      },
      size: {
        default: "h-10 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2 text-meta [&_svg:not([class*='size-'])]:size-4",
        sm: "h-8 gap-1.5 px-3 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-11 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-10",
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
