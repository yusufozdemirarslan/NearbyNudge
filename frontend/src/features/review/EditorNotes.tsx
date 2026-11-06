import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { Mark } from "@/components/Mark"
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
  const [openFor, setOpenFor] = React.useState(failed)
  if (openFor !== failed) {
    // A new result opens (or closes) the notes to match it.
    setOpenFor(failed)
    setOpen(failed)
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("border-t border-hairline", className)}>
      <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 py-2.5 text-left text-ui underline-offset-4 hover:underline">
        <Mark name={failed ? "asterisk" : "check"} className={cn(failed && "text-edge")} />
        <span className={cn("font-bold", failed && "text-edge")}>
          Editor: {editor.passed} of {editor.total} checks passed
        </span>
        {editor.fixes.length > 0 && (
          <span className="aside">
            {editor.fixes.length} {editor.fixes.length === 1 ? "fix" : "fixes"} made
          </span>
        )}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn("ml-auto size-4 transition-transform duration-(--dur-fast)", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-1 pb-4">
        <ul className="space-y-2">
          {editor.checks.map((check) => (
            <li key={check.key} className="flex gap-2 text-ui">
              <Mark name={check.passed ? "check" : "asterisk"} className={cn("mt-1", !check.passed && "text-edge")} />
              <span>
                <span className={cn("font-semibold", !check.passed && "text-edge")}>{check.label}</span>
                <span className="sr-only">{check.passed ? ": passed" : ": needs attention"}</span>
                {check.note && <span className="block italic">{check.note}</span>}
              </span>
            </li>
          ))}
        </ul>
        {editor.fixes.length > 0 && (
          <div className="space-y-1.5">
            <p className="aside">Fixes the editor made</p>
            <ul className="space-y-1">
              {editor.fixes.map((fix) => (
                <li key={fix} className="flex gap-2 text-ui">
                  <Mark name="dot" className="mt-1.5 size-2" />
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
