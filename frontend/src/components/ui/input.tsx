import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 px-3 py-1 text-body md:text-ui file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-ui file:font-semibold file:text-ink border border-ink bg-paper text-ink transition-[border-color,background-color] duration-(--dur-fast) outline-none placeholder:text-ink-soft disabled:cursor-not-allowed disabled:border-dashed disabled:bg-tint disabled:text-ink-soft aria-invalid:border-edge aria-invalid:outline-edge",
        className
      )}
      {...props}
    />
  )
}

export { Input }
