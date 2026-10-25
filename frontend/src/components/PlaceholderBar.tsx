import { cn } from "@/lib/utils"

export interface PlaceholderBarProps {
  /** Width of the final content: px number, or any CSS length ("12ch", "60%"). */
  width?: number | string
  /**
   * Height: "text" matches a line of the surrounding text (0.75em bar centred
   * in the line), "block" fills its box, or a px number.
   */
  height?: "text" | "block" | number
  className?: string
}

/**
 * A still gray bar sized like the content that will replace it, so nothing
 * shifts when the text arrives. No shimmer: research can take minutes and a
 * moving placeholder would be distracting (brief §3.4, WCAG 2.2.2).
 * Hidden from assistive technology; say what is loading in text elsewhere.
 */
export function PlaceholderBar({ width = "100%", height = "text", className }: PlaceholderBarProps) {
  const style: React.CSSProperties = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height === "text" ? "0.75em" : "100%",
  }
  return (
    <span
      aria-hidden="true"
      data-slot="placeholder-bar"
      className={cn(
        "inline-block max-w-full shrink-0 rounded-sm bg-[color-mix(in_srgb,var(--foreground)_9%,transparent)] align-middle",
        className
      )}
      style={style}
    />
  )
}
