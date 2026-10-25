import * as React from "react"
import {
  ArrowRightIcon,
  ClockIcon,
  MapPinIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
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

function CategoryChip({ category }: { category: PlanCategory }) {
  return (
    <li className="inline-flex h-7 items-center gap-1.5 rounded-sm border bg-card px-2 text-ui text-foreground">
      <span>{category.label}</span>
      {category.count !== null ? (
        <span className="font-semibold tabular-nums">
          {formatNumber(category.count)}
        </span>
      ) : (
        <span className="text-meta text-muted-foreground">not loaded yet</span>
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
      className="rounded-xl border bg-card"
    >
      {stale && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b bg-info-tint px-5 py-3">
          <p className="text-ui text-foreground">
            You changed the brief after this plan. Review the plan again before
            you start.
          </p>
          <Button size="sm" onClick={onReviewAgain}>
            <RotateCwIcon aria-hidden="true" />
            Review plan again
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="space-y-2">
          <div className="max-w-[68ch] text-email text-foreground">
            <span
              aria-hidden="true"
              className="mr-2 inline-flex h-6 items-center rounded-sm border border-[color-mix(in_srgb,var(--primary)_45%,transparent)] px-1.5 align-[2px] text-meta font-semibold text-primary"
            >
              AI
            </span>
            <Heading
              id={`${id}-title`}
              ref={headingRef}
              tabIndex={-1}
              className="inline text-email font-semibold outline-none"
            >
              {planLabel}:
            </Heading>{" "}
            <span>“{plan.restatement}”</span>
          </div>
          {plan.location.note && (
            <p className="flex items-center gap-1.5 text-ui text-ink-secondary">
              <MapPinIcon aria-hidden="true" className="size-4 shrink-0" />
              {plan.location.note}
            </p>
          )}
        </div>

        <dl className="grid gap-x-6 gap-y-1.5 text-ui lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:gap-y-3">
          <dt className="font-medium text-foreground lg:pt-1">Categories</dt>
          <dd className="min-w-0">
            {plan.categories.length > 0 ? (
              <ul
                aria-label="Listing categories"
                className="flex flex-wrap gap-1.5"
              >
                {plan.categories.map((category) => (
                  <CategoryChip key={category.key} category={category} />
                ))}
              </ul>
            ) : (
              <span className="text-ink-secondary">
                No listing categories matched.
              </span>
            )}
          </dd>
          {plan.candidate_count !== null && (
            <>
              <dt className="mt-2 font-medium text-foreground lg:mt-0">
                Matches
              </dt>
              <dd className="text-foreground">
                <span className="font-semibold tabular-nums">
                  {formatNumber(plan.candidate_count)}
                </span>{" "}
                {plan.candidate_count === 1
                  ? "business matches"
                  : "businesses match"}
                , after leaving out chains, closed places and your
                do-not-contact list
              </dd>
            </>
          )}
        </dl>

        {question && !stale && (
          <fieldset
            className="flex min-w-0 flex-col gap-2"
            aria-describedby={answerError ? `${id}-answer-error` : undefined}
          >
            <legend className="mb-2 text-ui font-medium text-foreground">
              <span className="text-ink-secondary">One question: </span>
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
                    className="flex min-h-10 min-w-24 cursor-pointer items-center gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--input)_55%,transparent)] bg-card px-3 py-2 text-ui font-medium text-foreground transition-colors hover:bg-muted has-data-checked:border-primary has-data-checked:bg-accent"
                  >
                    <RadioGroupItem value={value} />
                    {value === "yes" ? "Yes" : "No"}
                  </label>
                ))}
              </RadioGroup>
            </div>
            {question.categories.length > 0 && (
              <p className="text-meta text-ink-secondary">
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
                className="flex items-start gap-2 rounded-lg bg-warning-tint px-3 py-2.5 text-ui text-foreground"
              >
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-warning"
                />
                <span>
                  <span className="sr-only">Warning: </span>
                  {warning}
                </span>
              </li>
            ))}
            {loading && (
              <li className="flex items-start gap-2 rounded-lg bg-info-tint px-3 py-2.5 text-ui text-foreground">
                <ClockIcon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-info"
                />
                <span>
                  First search in this area takes about a minute longer. We're
                  loading the business listings for {plan.location.label} now.
                </span>
              </li>
            )}
          </ul>
        )}

        {!stale && (
          <div className="flex flex-col gap-3 border-t pt-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button size="lg" onClick={onStart} disabled={starting}>
                {starting
                  ? "Starting…"
                  : `Find ${plural(leadTarget, "business", "businesses")}`}
                {!starting && (
                  <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
                )}
              </Button>
              <p className="text-ui text-ink-secondary">
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
