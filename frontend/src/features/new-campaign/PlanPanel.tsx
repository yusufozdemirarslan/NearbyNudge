import * as React from "react"
import { Button } from "@/components/ui/button"
import { Mark } from "@/components/Mark"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { CampaignPlan, PlanCategory } from "@/lib/api/types"
import { formatNumber, joinList, plural } from "@/lib/format"
import { FieldMessage } from "@/features/settings/form-kit"

export interface PlanPanelProps {
  plan: CampaignPlan
  /** "Claude's plan" (from the AI's name in /api/status). */
  planLabel: string
  /** Businesses the planned brief asks for. */
  leadTarget: number
  /** The brief changed after this plan was made. */
  stale: boolean
  answer: "yes" | "no" | null
  onAnswer: (answer: "yes" | "no") => void
  answerError: string | null
  /** Receives the question's radio group, so the form can focus it. */
  questionRef: React.Ref<HTMLDivElement>
  /** Receives the panel's heading, focused when a new plan arrives. */
  headingRef: React.Ref<HTMLHeadingElement>
  starting: boolean
  onStart: () => void
  onReviewAgain: () => void
  /** A calm error with a way forward, shown under the start button. */
  startError?: React.ReactNode
  headingLevel?: 2 | 3
}

/** A listing category as a directory key line: name, dot leader, count. */
function CategoryLine({ category }: { category: PlanCategory }) {
  return (
    <li className="flex items-baseline gap-1.5 text-ui">
      <span>{category.label}</span>
      <span aria-hidden="true" className="leader" />
      {category.count !== null ? (
        <span className="numeral text-lead">{formatNumber(category.count)}</span>
      ) : (
        <span className="aside">not loaded yet</span>
      )}
    </li>
  )
}

/**
 * The AI's restated plan (CS2): what will be searched and where, the
 * listing categories with counts, at most one yes/no question, warnings, and
 * the button that starts the campaign. When the brief changes afterwards the
 * plan is marked out of date and must be reviewed again.
 */
export function PlanPanel({
  plan,
  planLabel,
  leadTarget,
  stale,
  answer,
  onAnswer,
  answerError,
  questionRef,
  headingRef,
  starting,
  onStart,
  onReviewAgain,
  startError,
  headingLevel = 2,
}: PlanPanelProps) {
  const id = React.useId()
  const Heading = headingLevel === 2 ? "h2" : "h3"
  const loading = plan.coverage === "loading_needed"
  const question = plan.question
  const questionCounts =
    question?.categories.filter((c) => c.count !== null) ?? []

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="plan-panel"
      className="border border-t-(length:--rule-heavy) border-ink"
    >
      {stale && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink px-5 py-3">
          <p className="flex items-center gap-2 text-ui font-bold text-edge">
            <Mark name="asterisk" />
            You changed the brief after this plan. Review the plan again before
            you start.
          </p>
          <Button size="sm" onClick={onReviewAgain}>
            Review plan again
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-6 p-5 sm:p-6">
        <div className="space-y-2">
          <div className="max-w-measure text-body">
            <span
              aria-hidden="true"
              className="mr-2 inline-flex h-6 items-center border border-ink px-1.5 align-[2px] text-micro font-extrabold stretch-condensed"
            >
              AI
            </span>
            <Heading
              id={`${id}-title`}
              ref={headingRef}
              tabIndex={-1}
              className="inline text-body font-bold outline-none"
            >
              {planLabel}:
            </Heading>{" "}
            <span className="italic">“{plan.restatement}”</span>
          </div>
          {plan.location.note && <p className="aside">{plan.location.note}</p>}
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-ui lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:gap-y-4">
          <dt className="font-bold lg:pt-0.5">Categories</dt>
          <dd className="min-w-0">
            {plan.categories.length > 0 ? (
              <ul aria-label="Listing categories" className="max-w-md space-y-1">
                {plan.categories.map((category) => (
                  <CategoryLine key={category.key} category={category} />
                ))}
              </ul>
            ) : (
              <span className="italic">No listing categories matched.</span>
            )}
          </dd>
          {plan.candidate_count !== null && (
            <>
              <dt className="mt-2 font-bold lg:mt-0 lg:pt-4">Matches</dt>
              <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="numeral text-display leading-none">
                  {formatNumber(plan.candidate_count)}
                </span>
                <span className="min-w-0 flex-1 basis-56">
                  {plan.candidate_count === 1
                    ? "business matches"
                    : "businesses match"}
                  , after leaving out chains, closed places and your{" "}
                  <span className="whitespace-nowrap">do-not-contact list</span>
                </span>
              </dd>
            </>
          )}
        </dl>

        {question && !stale && (
          <fieldset
            className="flex min-w-0 flex-col gap-2"
            aria-describedby={answerError ? `${id}-answer-error` : undefined}
          >
            <legend className="mb-2 text-ui font-bold">
              <span className="font-normal italic">One question: </span>
              {question.text}
            </legend>
            <div ref={questionRef}>
              <RadioGroup
                value={answer ?? ""}
                onValueChange={(value) =>
                  onAnswer(value === "yes" ? "yes" : "no")
                }
                aria-invalid={answerError ? true : undefined}
                className="flex flex-wrap gap-2"
              >
                {(["yes", "no"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex min-h-11 min-w-24 cursor-pointer items-center gap-2.5 border border-ink px-3 py-2 text-ui font-semibold transition-colors duration-(--dur-fast) hover:bg-tint has-data-checked:outline-2 has-data-checked:outline-ink has-data-checked:-outline-offset-2"
                  >
                    <RadioGroupItem value={value} />
                    {value === "yes" ? "Yes" : "No"}
                  </label>
                ))}
              </RadioGroup>
            </div>
            {question.categories.length > 0 && (
              <p className="aside">
                Yes adds {joinList(question.categories.map((c) => c.label))}
                {questionCounts.length > 0 &&
                  ` (${plural(
                    questionCounts.reduce((sum, c) => sum + (c.count ?? 0), 0),
                    "business",
                    "businesses"
                  )} nearby)`}
                .
              </p>
            )}
            {answerError && (
              <FieldMessage id={`${id}-answer-error`}>
                {answerError}
              </FieldMessage>
            )}
          </fieldset>
        )}

        {(plan.warnings.length > 0 || loading) && (
          <ul className="flex flex-col gap-2">
            {plan.warnings.map((warning) => (
              <li
                key={warning}
                className="flex items-start gap-2 border border-t-(length:--rule-heavy) border-ink border-t-edge px-3 py-2.5 text-ui"
              >
                <Mark name="asterisk" className="mt-1 text-edge" />
                <span>
                  <span className="sr-only">Warning: </span>
                  {warning}
                </span>
              </li>
            ))}
            {loading && (
              <li className="flex items-start gap-2 border border-ink px-3 py-2.5 text-ui">
                <Mark name="dot" className="mt-1" />
                <span>
                  First search in this area takes about a minute longer. We're
                  loading the business listings for {plan.location.label} now.
                </span>
              </li>
            )}
          </ul>
        )}

        {!stale && (
          <div className="flex flex-col gap-3 border-t-2 border-ink pt-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button size="lg" onClick={onStart} disabled={starting}>
                {starting
                  ? "Starting…"
                  : `Find ${plural(leadTarget, "business", "businesses")}`}
              </Button>
              <p className="aside">
                First results in about{" "}
                {loading ? "a minute and a half" : "30 seconds"}
              </p>
            </div>
            {startError}
          </div>
        )}
      </div>
    </section>
  )
}
