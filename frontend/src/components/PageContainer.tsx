import { cn } from "@/lib/utils"

/**
 * Standard page width and padding for app pages (not the review desk,
 * which fills the screen). Use "narrow" for forms and settings.
 */
export function PageContainer({
  children,
  width = "wide",
  className,
}: {
  children: React.ReactNode
  width?: "wide" | "narrow"
  className?: string
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
        width === "wide" ? "max-w-6xl" : "max-w-3xl",
        className
      )}
    >
      {children}
    </div>
  )
}
