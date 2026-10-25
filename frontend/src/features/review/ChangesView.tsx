import * as React from "react"
import { CheckIcon, Undo2Icon } from "lucide-react"
import { composeBody } from "@/lib/email"
import { cn } from "@/lib/utils"
import type { ChangeSnapshot } from "./desk-state"
import { changeCount, compose, diffText, type Hunk } from "./diff"
import { LockedFooter } from "./EmailBody"

export interface ChangesViewProps {
  snapshot: ChangeSnapshot
  /** Save the email with these changes reverted (PUT /email). */
  onApply: (reverted: string[], subject: string, body: string) => void
  busy: boolean
}

/**
 * "Show changes" after a rewrite: a word-level comparison of the previous
 * version and the rewrite. Each change is a toggle: pressed means reverted to
 * the old words. Every toggle saves the composed email.
 */
export function ChangesView({ snapshot, onApply, busy }: ChangesViewProps) {
  const subjectHunks = React.useMemo(
    () => diffText(snapshot.before.subject, snapshot.after.subject),
    [snapshot.before.subject, snapshot.after.subject]
  )
  const bodyHunks = React.useMemo(
    () => diffText(composeBody(snapshot.before), composeBody(snapshot.after)),
    [snapshot.before, snapshot.after]
  )
  const reverted = new Set(snapshot.reverted)
  const total = changeCount(subjectHunks) + changeCount(bodyHunks)

  const toggle = (key: string) => {
    const next = new Set(reverted)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    const subjectReverted = new Set([...next].filter((k) => k.startsWith("subject:")).map((k) => Number(k.split(":")[1])))
    const bodyReverted = new Set([...next].filter((k) => k.startsWith("body:")).map((k) => Number(k.split(":")[1])))
    onApply([...next], compose(subjectHunks, subjectReverted), compose(bodyHunks, bodyReverted))
  }

  return (
    <div className="rounded-xl border bg-card" data-slot="changes-view" aria-busy={busy}>
      <p className="border-b px-5 py-3 text-meta text-ink-secondary sm:px-6">
        {total === 0
          ? "The rewrite didn't change any words."
          : `${total} ${total === 1 ? "change" : "changes"}. Removed words are struck through, new words are underlined. Select a change to revert it; select it again to keep the new words.`}
      </p>
      <div className="flex items-baseline gap-3 border-b px-5 py-3.5 sm:px-6">
        <span className="shrink-0 text-meta font-medium text-muted-foreground">Subject</span>
        <span className="min-w-0 text-email font-semibold whitespace-pre-wrap">
          <Hunks hunks={subjectHunks} prefix="subject" reverted={reverted} onToggle={toggle} busy={busy} />
        </span>
      </div>
      <div className="max-w-[68ch] px-5 py-5 text-email whitespace-pre-wrap sm:px-6">
        <Hunks hunks={bodyHunks} prefix="body" reverted={reverted} onToggle={toggle} busy={busy} />
      </div>
      <LockedFooter footer={snapshot.after.footer} />
    </div>
  )
}

function Hunks({
  hunks,
  prefix,
  reverted,
  onToggle,
  busy,
}: {
  hunks: Hunk[]
  prefix: "subject" | "body"
  reverted: ReadonlySet<string>
  onToggle: (key: string) => void
  busy: boolean
}) {
  let number = 0
  return (
    <>
      {hunks.map((hunk, index) => {
        if (hunk.kind === "same") return <React.Fragment key={index}>{hunk.tokens.join("")}</React.Fragment>
        number += 1
        const key = `${prefix}:${hunk.id}`
        const isReverted = reverted.has(key)
        const removed = hunk.removed.join("").trim()
        const added = hunk.added.join("").trim()
        // The name starts with the visible words (WCAG 2.5.3), then explains them.
        const visible = [removed, added].filter(Boolean).join(" ")
        const explain = removed && added ? "Old words, then the new words." : added ? "Added words." : "Removed words."
        const label = `${visible}. ${explain}`
        return (
          <button
            key={index}
            type="button"
            aria-pressed={isReverted}
            aria-label={`${label} ${isReverted ? "Reverted to the old words. Select to keep the new ones." : "Select to revert."}`}
            disabled={busy}
            onClick={() => onToggle(key)}
            data-change={number}
            className={cn(
              "group/change mx-px inline rounded-sm px-0.5 text-left align-baseline transition-colors duration-150 [box-decoration-break:clone] hover:bg-muted disabled:opacity-60",
              isReverted && "bg-muted"
            )}
          >
            {removed && (
              <del
                className={cn(
                  "decoration-[1.5px]",
                  isReverted
                    ? "text-foreground no-underline"
                    : "bg-danger-tint text-ink-secondary line-through decoration-destructive"
                )}
              >
                {removed}
              </del>
            )}
            {removed && added && " "}
            {added && (
              <ins
                className={cn(
                  "decoration-2 underline-offset-[5px]",
                  isReverted
                    ? "text-muted-foreground line-through decoration-muted-foreground"
                    : "bg-success-tint text-foreground underline decoration-success"
                )}
              >
                {added}
              </ins>
            )}
            <span
              aria-hidden="true"
              className="relative -top-px ml-1 inline-flex size-5 items-center justify-center rounded-sm border bg-card align-middle text-ink-secondary group-hover/change:border-primary group-hover/change:text-primary"
            >
              {isReverted ? <CheckIcon className="size-3.5" /> : <Undo2Icon className="size-3.5" />}
            </span>
          </button>
        )
      })}
    </>
  )
}
