import * as React from "react"
import { CheckIcon, ChevronDownIcon, ClipboardCheckIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { EditorReport } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/**
 * "Editor: 4 of 4 checks passed", expandable to each check and the fixes the
 * editor made ("Shortened the subject from 12 to 6 words"). Starts open when a
 * check failed.
 */
export function EditorNotes({ editor, className }: { editor: EditorReport; className?: string }) {
  const failed = editor.passed < editor.total
  const [open, setOpen] = React.useState(failed)
  React.useEffect(() => setOpen(failed), [failed])
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-xl border bg-card", className)}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-ui hover:bg-muted/60">
        {failed ? (
          <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-warning" />
        ) : (
          <ClipboardCheckIcon aria-hidden="true" className="size-4 shrink-0 text-success" />
        )}
        <span className="font-medium text-foreground">
          Editor: {editor.passed} of {editor.total} checks passed
        </span>
        {editor.fixes.length > 0 && (
          <span className="text-meta text-muted-foreground">
            · {editor.fixes.length} {editor.fixes.length === 1 ? "fix" : "fixes"} made
          </span>
        )}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn("ml-auto size-4 text-muted-foreground transition-transform duration-150", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t px-4 pt-3 pb-4">
        <ul className="space-y-2">
          {editor.checks.map((check) => (
            <li key={check.key} className="flex gap-2 text-ui">
              {check.passed ? (
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              )}
              <span>
                <span className={cn("font-medium", check.passed ? "text-foreground" : "text-warning")}>{check.label}</span>
                <span className="sr-only">{check.passed ? ": passed" : ": needs attention"}</span>
                {check.note && <span className="block text-ink-secondary">{check.note}</span>}
              </span>
            </li>
          ))}
        </ul>
        {editor.fixes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-meta font-medium text-muted-foreground">Fixes the editor made</p>
            <ul className="space-y-1">
              {editor.fixes.map((fix) => (
                <li key={fix} className="flex gap-2 text-ui text-ink-secondary">
                  <WrenchIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {fix}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
