import { cn } from "@/lib/utils"

/**
 * Loading, set as a dot leader that fills in. Three dots appear one by one;
 * under reduced motion they simply stand still.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      viewBox="0 0 20 6"
      className={cn("h-1.5 w-5 animate-dots fill-current", className)}
      {...props}
    >
      <circle cx="3" cy="3" r="2" />
      <circle cx="10" cy="3" r="2" />
      <circle cx="17" cy="3" r="2" />
    </svg>
  )
}

export { Spinner }
