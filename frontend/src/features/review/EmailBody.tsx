import * as React from "react"
import { Link } from "@tanstack/react-router"
import { PencilIcon } from "lucide-react"
import { Mark } from "@/components/Mark"
import type { Email, Fact, Sentence } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { useDesk } from "./desk-state"

export interface EmailBodyProps {
  email: Email
  facts: Fact[]
  /** Fact id → footnote number (1, 2) by first appearance. */
  numbers: Map<string, number>
  /** Show the footnote numbers and sentence states (off for read-only previews). */
  annotated?: boolean
  className?: string
}

const STATE_CLASS: Record<Sentence["state"], string> = {
  supported: "",
  none: "",
  check: "underline decoration-edge decoration-dotted decoration-2 underline-offset-5",
  no_source: "underline decoration-edge decoration-wavy decoration-[1.5px] underline-offset-5",
}

/**
 * The letter as the business will read it, under a heavy rule, plus the
 * footnote layer: each claim carries superscript numbers in order of first
 * appearance. Hovering or focusing a number lights its source in the evidence
 * column (and the other way round). The numbers never appear in the copied or
 * opened email.
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
    <div className={cn("border-t-(length:--rule-heavy) border-ink", className)} data-slot="email-card">
      <div className="flex items-baseline gap-3 border-b border-hairline py-3.5">
        <span className="shrink-0 aside">Subject</span>
        <span className="min-w-0 text-lead font-bold">{email.subject}</span>
      </div>
      <div className="max-w-measure pt-5 text-body" data-slot="email-text">
        <p className="mb-6">{email.greeting}</p>
        {email.paragraphs.map((paragraph, pi) => (
          <p key={pi} className="mb-6">
            {paragraph.map((sentence) => {
              const lit = annotated && desk.activeFactId !== null && sentence.fact_ids.includes(desk.activeFactId)
              return (
                <React.Fragment key={sentence.id}>
                  <span
                    ref={register(sentence.id)}
                    data-sentence-id={sentence.id}
                    data-state={sentence.state}
                    className={cn(
                      "transition-colors duration-(--dur-fast) [box-decoration-break:clone]",
                      annotated && STATE_CLASS[sentence.state],
                      lit && "bg-tint"
                    )}
                  >
                    {sentence.text}
                  </span>
                  {annotated && <SentenceMarks sentence={sentence} numbers={numbers} factById={factById} />}{" "}
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
              "ml-px inline-flex h-4 min-w-4 items-center justify-center px-0.5 align-super text-micro leading-none font-extrabold stretch-condensed tabular-nums transition-colors duration-(--dur-fast)",
              active ? "bg-ink text-paper" : "underline decoration-1 underline-offset-2 hover:text-edge"
            )}
          >
            {n}
          </button>
        )
      })}
      {(sentence.state === "check" || sentence.state === "no_source") && (
        <span
          className="ml-1 inline-flex items-baseline gap-1 align-baseline text-meta font-bold text-edge"
          data-slot="sentence-flag"
        >
          <Mark name="asterisk" className="size-2.5 self-center" />
          {sentence.state === "check" ? "Check" : "No source"}
        </span>
      )}
      {sentence.edited && (
        <span className="ml-1 inline-flex align-baseline">
          <PencilIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(edited by you)</span>
        </span>
      )}
    </>
  )
}

/** The legal footer: shown under every email, edited only in Settings. */
export function LockedFooter({ footer }: { footer: string }) {
  return (
    <div className="mt-2 border-t border-dashed border-leader pt-4 pb-1" data-slot="locked-footer">
      <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 aside">
        <Mark name="lock" />
        <span>Footer added to every email.</span>
        <Link to="/settings" className="font-semibold not-italic underline underline-offset-3 hover:text-edge">
          Edit in Settings
        </Link>
      </p>
      <p className="text-ui whitespace-pre-line">{footer}</p>
    </div>
  )
}
