import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full px-3 py-2.5 text-body md:text-ui border border-ink bg-paper text-ink transition-[border-color,background-color] duration-(--dur-fast) outline-none placeholder:text-ink-soft disabled:cursor-not-allowed disabled:border-dashed disabled:bg-tint disabled:text-ink-soft aria-invalid:border-edge aria-invalid:outline-edge",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
