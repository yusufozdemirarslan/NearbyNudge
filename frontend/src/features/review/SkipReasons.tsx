import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { KeyHint } from "@/components/KeyHint"
import { useShortcuts } from "@/hooks/use-shortcuts"
import { cn } from "@/lib/utils"

export const SKIP_REASONS = ["Already a client", "Not a fit", "Wrong place"] as const

export interface SkipReasonsProps {
  title?: string
  onChoose: (reason: string) => void
  onCancel: () => void
  busy?: boolean
  /** Smaller chips for the list's bulk bar. */
  compact?: boolean
  className?: string
}

/**
 * Numbered skip reasons (brief §3.4): 1 Already a client, 2 Not a fit,
 * 3 Wrong place, 4 Other (then a text box), so a skip takes two keys.
 * While open, 1–4 pick a reason and Esc cancels.
 */
export function SkipReasons({ title = "Why skip?", onChoose, onCancel, busy, compact, className }: SkipReasonsProps) {
  const [other, setOther] = React.useState(false)
  const [text, setText] = React.useState("")
  const firstRef = React.useRef<HTMLButtonElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const titleId = React.useId()

  React.useEffect(() => {
    if (other) inputRef.current?.focus()
    else firstRef.current?.focus()
  }, [other])

  useShortcuts(
    {
      "1": { description: "Skip: Already a client", handler: () => onChoose(SKIP_REASONS[0]), group: "Skip reasons" },
      "2": { description: "Skip: Not a fit", handler: () => onChoose(SKIP_REASONS[1]), group: "Skip reasons" },
      "3": { description: "Skip: Wrong place", handler: () => onChoose(SKIP_REASONS[2]), group: "Skip reasons" },
      "4": { description: "Skip: Other reason", handler: () => setOther(true), group: "Skip reasons" },
      escape: { description: "Cancel", handler: onCancel, allowInInputs: true, group: "Skip reasons" },
    },
    { enabled: !busy, group: "Skip reasons" }
  )

  const size = compact ? "xs" : "sm"
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-slot="skip-reasons"
      className={cn("flex w-full flex-wrap items-center gap-1.5", className)}
    >
      <span
        id={titleId}
        className={cn("font-bold", compact ? "mr-1 text-meta" : "w-full pb-0.5 text-ui")}
      >
        {title}
      </span>
      {other ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (text.trim()) onChoose(text.trim())
          }}
        >
          <Input
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Reason"
            aria-label="Other reason for skipping"
            maxLength={120}
            className={cn("min-w-0 flex-1", compact ? "h-7" : "h-9")}
          />
          <Button type="submit" size={size} disabled={!text.trim() || busy}>
            Skip
          </Button>
        </form>
      ) : (
        <>
          {SKIP_REASONS.map((reason, index) => (
            <Button
              key={reason}
              ref={index === 0 ? firstRef : undefined}
              size={size}
              variant="outline"
              disabled={busy}
              aria-keyshortcuts={String(index + 1)}
              onClick={() => onChoose(reason)}
            >
              <KeyHint keys={String(index + 1)} />
              {reason}
            </Button>
          ))}
          <Button size={size} variant="outline" disabled={busy} aria-keyshortcuts="4" onClick={() => setOther(true)}>
            <KeyHint keys="4" />
            Other…
          </Button>
        </>
      )}
      <Button size={size} variant="ghost" onClick={onCancel} disabled={busy} aria-keyshortcuts="Escape">
        Cancel
      </Button>
    </div>
  )
}
