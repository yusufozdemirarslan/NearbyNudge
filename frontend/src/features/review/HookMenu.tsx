import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { SourceTag } from "@/components/SourceTag"
import type { Fact, Hook } from "@/lib/api/types"
import { cn } from "@/lib/utils"

export interface HookMenuProps {
  hook: Hook
  alternatives: Hook[]
  facts: Fact[]
  /** Rewrite with another hook; null when the email can't be changed now. */
  onUse: ((hookId: string) => void) | null
  /** Why rewriting is unavailable (shown in the menu). */
  lockedReason?: string | null
  className?: string
}

function Evidence({ hook, facts }: { hook: Hook; facts: Fact[] }) {
  const cited = hook.fact_ids.map((id) => facts.find((fact) => fact.id === id)).filter((f): f is Fact => Boolean(f))
  if (cited.length === 0) return <p className="text-meta text-muted-foreground">No saved evidence for this hook.</p>
  return (
    <ul className="space-y-1.5">
      {cited.map((fact) => (
        <li key={fact.id} className="space-y-1">
          <p className="text-ui text-foreground">{fact.text}</p>
          {fact.source_kind === "listing" ? (
            <SourceTag kind="listing" label={fact.source_label} />
          ) : (
            <SourceTag
              kind={fact.source_kind}
              label={fact.source_label}
              date={fact.seen_at}
              href={fact.fragment_url ?? fact.url}
              quote={fact.quote}
              quoteFound={fact.quote_found}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * "Hook: Online booking (+2 more)". Opens the chosen hook and its two
 * alternatives, each with its evidence. Picking one rewrites the email
 * (POST /rewrite, mode another_hook, with the hook's id).
 */
export function HookMenu({ hook, alternatives, facts, onUse, lockedReason, className }: HookMenuProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="xs" className={cn("max-w-full gap-1.5 font-normal", className)} />
        }
      >
        <span className="text-muted-foreground">Hook:</span>
        <span className="truncate font-medium text-foreground">{hook.title}</span>
        {alternatives.length > 0 && <span className="text-muted-foreground">(+{alternatives.length} more)</span>}
        <ChevronDownIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[24rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="space-y-2 border-b p-4">
          <PopoverTitle className="text-meta font-medium text-muted-foreground">Chosen hook</PopoverTitle>
          <p className="text-ui font-semibold text-foreground">{hook.title}</p>
          <p className="text-ui text-ink-secondary">{hook.reason}</p>
          <Evidence hook={hook} facts={facts} />
        </div>
        {alternatives.length > 0 && (
          <div className="max-h-[22rem] space-y-0 overflow-y-auto">
            <p className="px-4 pt-3 text-meta font-medium text-muted-foreground">Other hooks</p>
            {alternatives.map((alt) => (
              <div key={alt.id} className="space-y-2 border-b px-4 py-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-ui font-semibold text-foreground">{alt.title}</p>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!onUse}
                    onClick={() => {
                      setOpen(false)
                      onUse?.(alt.id)
                    }}
                  >
                    Use this hook
                  </Button>
                </div>
                <p className="text-ui text-ink-secondary">{alt.reason}</p>
                <Evidence hook={alt} facts={facts} />
              </div>
            ))}
          </div>
        )}
        {lockedReason && <p className="border-t px-4 py-2.5 text-meta text-muted-foreground">{lockedReason}</p>}
      </PopoverContent>
    </Popover>
  )
}
