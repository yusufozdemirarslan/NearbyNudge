import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * An email address that wraps only after "@" and dots, so narrow columns show
 * "office@ / samplestudio.example" instead of breaking inside a word.
 */
export function EmailAddress({ email, className }: { email: string; className?: string }) {
  const parts = email.split(/(?<=[@.])/u)
  return (
    <span className={cn("[overflow-wrap:anywhere]", className)} data-slot="email-address">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </React.Fragment>
      ))}
    </span>
  )
}
