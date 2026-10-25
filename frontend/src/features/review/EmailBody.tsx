import * as React from "react"
import { Link } from "@tanstack/react-router"
import { LockIcon, PencilIcon, TriangleAlertIcon } from "lucide-react"
import type { Email, Fact, Sentence } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { useDesk } from "./desk-state"

export interface EmailBodyProps {
  email: Email
  facts: Fact[]
  /** Fact id → display number ([1], [2]) by first appearance. */
  numbers: Map<string, number>
  /** Show the citation markers and sentence states (off for read-only previews). */
  annotated?: boolean
  className?: string
}

const STATE_CLASS: Record<Sentence["state"], string> = {
  supported: "",
  none: "",
  check: "underline decoration-warning decoration-dotted decoration-2 underline-offset-[5px]",
  no_source: "underline decoration-warning decoration-wavy decoration-[1.5px] underline-offset-[5px]",
}

/**
 * The email as the prospect will read it, plus the signature layer: each claim
 * sentence carries citation markers numbered by first appearance. Hovering or
 * focusing a marker highlights its fact in the evidence column (and the other
 * way round). Markers never appear in the copied or opened email.
 */
export function EmailBody({ email, facts, numbers, annotated = true, className }: EmailBodyProps) {
  const desk = useDesk()
  const factById = React.useMemo(() => new Map(facts.map((fact) => [fact.id, fact])), [facts])

  const register = React.useCallback(
    (id: string) => (el: HTMLSpanElement | null) => {
      const map = desk.sentenceEls.current
      if (el) map.set(id, el)
      else map.delete(id)
    },
    [desk.sentenceEls]
  )

  return (
    <div className={cn("rounded-xl border bg-card", className)} data-slot="email-card">
      <div className="flex items-baseline gap-3 border-b px-5 py-3.5 sm:px-6">
        <span className="shrink-0 text-meta font-medium text-muted-foreground">Subject</span>
        <span className="min-w-0 text-email font-semibold text-foreground">{email.subject}</span>
      </div>
      <div className="max-w-[68ch] px-5 py-5 text-email text-foreground sm:px-6" data-slot="email-text">
        <p className="mb-[25px]">{email.greeting}</p>
        {email.paragraphs.map((paragraph, pi) => (
          <p key={pi} className="mb-[25px]">
            {paragraph.map((sentence) => {
              const lit = annotated && desk.activeFactId !== null && sentence.fact_ids.includes(desk.activeFactId)
              return (
                <React.Fragment key={sentence.id}>
                  <span
                    ref={register(sentence.id)}
                    data-sentence-id={sentence.id}
                    data-state={sentence.state}
                    className={cn(
                      "rounded-sm transition-colors duration-150 [box-decoration-break:clone]",
                      annotated && STATE_CLASS[sentence.state],
                      lit && "bg-accent"
                    )}
                  >
                    {sentence.text}
                  </span>
                  {annotated && (
                    <SentenceMarks sentence={sentence} numbers={numbers} factById={factById} />
                  )}{" "}
                </React.Fragment>
              )
            })}
          </p>
        ))}
        <p>{email.signoff}</p>
      </div>
      <LockedFooter footer={email.footer} />
    </div>
  )
}

function SentenceMarks({
  sentence,
  numbers,
  factById,
}: {
  sentence: Sentence
  numbers: Map<string, number>
  factById: Map<string, Fact>
}) {
  const desk = useDesk()
  return (
    <>
      {sentence.fact_ids.map((factId) => {
        const n = numbers.get(factId)
        const fact = factById.get(factId)
        if (!n) return null
        const active = desk.activeFactId === factId
        return (
          <button
            key={factId}
            type="button"
            data-marker={n}
            aria-label={`Fact ${n}: ${fact?.text ?? ""}${fact ? ` Source: ${fact.source_label}.` : ""} Show it in the evidence.`}
            onMouseEnter={() => desk.setActiveFactId(factId)}
            onMouseLeave={() => desk.setActiveFactId(null)}
            onFocus={() => desk.setActiveFactId(factId)}
            onBlur={() => desk.setActiveFactId(null)}
            onClick={() => {
              const target = document.getElementById(`fact-${factId}`)
              target?.scrollIntoView({
                block: "nearest",
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              })
              target?.focus({ preventScroll: true })
            }}
            className={cn(
              "relative -top-px ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-sm border px-1 align-baseline text-meta leading-none font-semibold tabular-nums transition-colors duration-150",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-card text-primary hover:bg-accent"
            )}
          >
            {n}
          </button>
        )
      })}
      {(sentence.state === "check" || sentence.state === "no_source") && (
        <span
          className="relative -top-px ml-1 inline-flex h-5 items-center gap-1 rounded-sm bg-warning-tint px-1.5 align-baseline text-meta leading-none font-semibold text-warning"
          data-slot="sentence-flag"
        >
          <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
          {sentence.state === "check" ? "Check" : "No source"}
        </span>
      )}
      {sentence.edited && (
        <span className="relative -top-px ml-1 inline-flex align-baseline text-muted-foreground">
          <PencilIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(edited by you)</span>
        </span>
      )}
    </>
  )
}

/** The legal footer (WR2): shown under every email, edited only in Settings. */
export function LockedFooter({ footer }: { footer: string }) {
  return (
    <div className="border-t border-dashed px-5 pt-4 pb-5 sm:px-6" data-slot="locked-footer">
      <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
        <LockIcon aria-hidden="true" className="size-3.5" />
        <span>Footer added to every email.</span>
        <Link to="/settings" className="font-medium text-primary hover:underline">
          Edit in Settings
        </Link>
      </p>
      <p className="text-ui whitespace-pre-line text-ink-secondary">{footer}</p>
    </div>
  )
}
