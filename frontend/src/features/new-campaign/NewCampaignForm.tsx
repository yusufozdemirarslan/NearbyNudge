import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Mark } from "@/components/Mark"
import { Controller, useForm, useWatch } from "react-hook-form"
import { CalmError } from "@/components/CalmError"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useAccount, useAiName } from "@/hooks/use-account"
import { useAnnounce } from "@/hooks/use-announce"
import { api, isApiError } from "@/lib/api"
import { industriesQuery, lastInputQuery, qk } from "@/lib/api/queries"
import type {
  CampaignInput,
  CampaignPlan,
  CreateCampaignRequest,
  SenderProfile,
  Usage,
} from "@/lib/api/types"
import { plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { addressLines } from "@/features/settings/footer"
import {
  FieldMessage,
  applyServerErrors,
  inputClass,
  serverFieldErrors,
  type ControlProps,
} from "@/features/settings/form-kit"
import { TONES } from "@/features/settings/SenderProfileForm"
import { LocationCombobox } from "./LocationCombobox"
import { PlanPanel } from "./PlanPanel"
import {
  CAMPAIGN_FIELDS,
  MAX_LEADS,
  MIN_LEADS,
  RADIUS_OPTIONS,
  campaignDefaults,
  campaignSchema,
  sameInput,
  toCampaignInput,
  type CampaignFormValues,
} from "./schema"

// ---------------------------------------------------------------------------
// Layout: label on the left on wide screens (brief 3.5 wireframe), stacked on
// narrow ones. Hints and errors sit under the control and are linked to it.
// ---------------------------------------------------------------------------

interface BriefFieldProps {
  label: React.ReactNode
  optional?: boolean
  required?: boolean
  hint?: React.ReactNode
  error?: string
  /** A second, separately labelled control on the same row ("within", "Tone"). */
  aside?: React.ReactNode
  /** Content under the control row (suggestion chips, extra errors). */
  after?: React.ReactNode
  children: (control: ControlProps) => React.ReactNode
}

function BriefField({
  label,
  optional,
  required,
  hint,
  error,
  aside,
  after,
  children,
}: BriefFieldProps) {
  const generated = React.useId()
  const id = `brief${generated.replace(/:/gu, "")}`
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined
  return (
    <div className="grid gap-x-6 gap-y-1.5 lg:grid-cols-[7.5rem_minmax(0,1fr)]">
      <label htmlFor={id} className="w-fit text-ui font-bold lg:pt-2.5">
        {label}
        {optional && <span className="font-normal italic"> (optional)</span>}
      </label>
      {/* With a second control: side by side from 640 px; on phones it moves under the hint. */}
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 items-center gap-x-3 gap-y-1.5",
          aside !== undefined && "sm:grid-cols-[minmax(0,1fr)_auto]"
        )}
      >
        <div className="flex min-w-0">
          {children({
            id,
            "aria-describedby": describedBy,
            "aria-invalid": error ? true : undefined,
            "aria-required": required ? true : undefined,
          })}
        </div>
        {aside !== undefined && (
          <div className="order-last pt-1.5 sm:order-none sm:pt-0">{aside}</div>
        )}
        {hint && (
          <p id={hintId} className="aside sm:col-span-full">
            {hint}
          </p>
        )}
        {error && (
          <FieldMessage id={errorId} className="sm:col-span-full">
            {error}
          </FieldMessage>
        )}
        {after !== undefined && <div className="sm:col-span-full">{after}</div>}
      </div>
    </div>
  )
}

/** A labelled select that sits beside the main control ("within 5 mi", "Tone"). */
function AsideSelect({
  label,
  error,
  children,
  ...select
}: React.ComponentProps<typeof NativeSelect> & {
  label: string
  error?: string
}) {
  const generated = React.useId()
  const id = `aside${generated.replace(/:/gu, "")}`
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <label htmlFor={id} className="text-ui font-bold">
        {label}
      </label>
      <NativeSelect
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...select}
      >
        {children}
      </NativeSelect>
      {error && (
        <FieldMessage id={`${id}-error`} className="basis-full">
          {error}
        </FieldMessage>
      )}
    </div>
  )
}

function BriefSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading your last campaign's details</span>
      {[0, 1, 2, 3, 4].map((row) => (
        <div
          key={row}
          className="grid gap-x-6 gap-y-1.5 lg:grid-cols-[7.5rem_minmax(0,1fr)]"
        >
          <PlaceholderBar width={72} className="lg:mt-3" />
          <PlaceholderBar width="100%" className="mt-3 block" />
        </div>
      ))}
    </div>
  )
}

/** "Checking listings…" while the plan is made (3–8 s): a calm line, no overlay. */
function PlanningLine({
  location,
  aiName,
}: {
  location: string
  aiName: string | null
}) {
  const [slow, setSlow] = React.useState(false)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div data-testid="planning" className="flex items-start gap-3 border border-ink px-5 py-4">
      <Mark name="dot" className="mt-1 animate-working motion-reduce:animate-none" />
      <div className="space-y-0.5">
        <p className="text-ui font-bold">
          Checking listings near {location || "your location"} and asking{" "}
          {aiName ?? "the AI"} to restate your plan…
        </p>
        <p className="aside">
          {slow
            ? "Still working. This can take up to 15 seconds."
            : "This usually takes a few seconds."}
        </p>
      </div>
    </div>
  )
}

function senderLine(profile: SenderProfile): string {
  const firstAddress = addressLines(profile.sender_address)[0]
  return [profile.sender_name, profile.sender_company, firstAddress]
    .filter(Boolean)
    .join(", ")
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export interface NewCampaignFormProps {
  /** Heading level of the plan panel (2 on its own page, 3 when embedded). */
  headingLevel?: 2 | 3
}

/**
 * The New campaign setup (CS1–CS2, brief 3.5): where, who and what you
 * offer, the AI's restated plan with at most one question, then "Find N
 * businesses". Pre-filled from the last campaign. Used on /campaigns/new and
 * as the first-run home screen.
 */
export function NewCampaignForm({ headingLevel = 2 }: NewCampaignFormProps) {
  const lastInput = useQuery(lastInputQuery())
  const account = useAccount()
  if (lastInput.isPending || account.isPending) return <BriefSkeleton />
  return (
    <BriefForm
      initial={campaignDefaults(
        lastInput.data?.input ?? null,
        account.data?.profile ?? null
      )}
      profile={account.data?.profile ?? null}
      usage={account.data?.usage ?? null}
      headingLevel={headingLevel}
    />
  )
}

interface Planned {
  plan: CampaignPlan
  input: CampaignInput
}

function BriefForm({
  initial,
  profile,
  usage,
  headingLevel,
}: {
  initial: CampaignFormValues
  profile: SenderProfile | null
  usage: Usage | null
  headingLevel: 2 | 3
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const announce = useAnnounce()
  const { name: aiName, label: aiLabel } = useAiName()
  const industries = useQuery(industriesQuery())

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: initial,
    mode: "onSubmit",
    reValidateMode: "onChange",
  })
  const {
    register,
    control,
    handleSubmit,
    setError,
    setFocus,
    setValue,
    formState,
  } = form
  const errors = formState.errors

  const [planned, setPlanned] = React.useState<Planned | null>(null)
  const [answer, setAnswer] = React.useState<"yes" | "no" | null>(null)
  const [answerError, setAnswerError] = React.useState<string | null>(null)
  const planHeadingRef = React.useRef<HTMLHeadingElement>(null)
  const questionRef = React.useRef<HTMLDivElement>(null)
  const focusPlan = React.useRef(false)

  // A new plan appears below the form: move focus to it so it isn't missed.
  React.useEffect(() => {
    if (planned && focusPlan.current) {
      focusPlan.current = false
      planHeadingRef.current?.focus()
    }
  }, [planned])

  const values = useWatch({ control })
  const current = toCampaignInput(values)
  const stale = planned !== null && !sameInput(planned.input, current)

  const planMutation = useMutation({
    mutationFn: (input: CampaignInput) => api.planCampaign(input),
  })
  const createMutation = useMutation({
    mutationFn: (request: CreateCampaignRequest) => api.createCampaign(request),
  })
  // Both clicks of a double-click arrive before isPending reaches this render, so a ref
  // holds the start until it fails (a started campaign uses the plan up).
  const startingRef = React.useRef(false)

  const runReview = (data: CampaignFormValues) => {
    const input = toCampaignInput(data)
    setPlanned(null)
    setAnswer(null)
    setAnswerError(null)
    createMutation.reset()
    startingRef.current = false
    announce("Reviewing your plan. This takes a few seconds.")
    planMutation.mutate(input, {
      onSuccess: (plan) => {
        focusPlan.current = true
        setPlanned({ plan, input })
        announce(
          `${aiLabel("plan")} is ready.${plan.question ? " It has one question for you." : ""}`
        )
      },
      onError: (error) => {
        applyServerErrors(error, { setError, setFocus }, CAMPAIGN_FIELDS)
      },
    })
  }
  /** "Review plan": validates the brief (focusing the first problem), then asks for a plan. */
  const review = (event?: React.BaseSyntheticEvent) =>
    handleSubmit(runReview)(event)

  const start = () => {
    if (!planned || stale || createMutation.isPending || startingRef.current)
      return
    if (planned.plan.question && !answer) {
      setAnswerError("Choose Yes or No to continue.")
      questionRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus()
      return
    }
    startingRef.current = true
    createMutation.mutate(
      {
        plan_id: planned.plan.plan_id,
        input: planned.input,
        answer: planned.plan.question ? answer : null,
      },
      {
        onSuccess: async (campaign) => {
          queryClient.setQueryData(qk.campaign(campaign.id), campaign)
          void queryClient.invalidateQueries({
            queryKey: qk.campaigns(),
            refetchType: "none",
          })
          void queryClient.invalidateQueries({ queryKey: qk.lastInput() })
          void queryClient.invalidateQueries({ queryKey: qk.account() })
          announce(`Campaign started: ${campaign.name}`)
          await navigate({
            to: "/campaigns/$campaignId",
            params: { campaignId: campaign.id },
            search: {},
          })
        },
        onError: (error) => {
          startingRef.current = false
          if (
            applyServerErrors(error, { setError, setFocus }, CAMPAIGN_FIELDS, {
              prefix: "input.",
            })
          )
            setPlanned(null)
        },
      }
    )
  }

  const planFieldError = CAMPAIGN_FIELDS.some(
    (name) => name in serverFieldErrors(planMutation.error)
  )
  const industry = (values.industry ?? "").trim().toLowerCase()
  const leadsLeft = usage ? Math.max(0, usage.limit - usage.used) : null
  const month = usage?.month_label.split(" ")[0]

  return (
    <div className="flex flex-col gap-6">
      <form
        noValidate
        onSubmit={review}
        aria-label="Campaign brief"
        className="flex flex-col gap-5"
      >
        <Controller
          control={control}
          name="location"
          render={({ field }) => (
            <BriefField
              label="Where"
              required
              hint="A city with its state, or a ZIP code. We search from its center."
              error={errors.location?.message}
              aside={
                <AsideSelect
                  label="within"
                  error={errors.radius_mi?.message}
                  {...register("radius_mi", { valueAsNumber: true })}
                >
                  {[...new Set<number>([...RADIUS_OPTIONS, initial.radius_mi])]
                    .sort((a, b) => a - b)
                    .map((miles) => (
                      <NativeSelectOption key={miles} value={miles}>
                        {miles} mi
                      </NativeSelectOption>
                    ))}
                </AsideSelect>
              }
            >
              {(controlProps) => (
                <div className="flex min-w-0 grow">
                  <LocationCombobox
                    {...controlProps}
                    name={field.name}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    placeholder="Arlington, VA or 22201"
                  />
                </div>
              )}
            </BriefField>
          )}
        />

        <BriefField
          label="Who"
          required
          error={errors.industry?.message}
          after={
            industries.data && industries.data.suggestions.length > 0 ? (
              <div
                className="flex flex-wrap items-center gap-1.5 pt-0.5"
                role="group"
                aria-labelledby="industry-suggestions"
              >
                <span id="industry-suggestions" className="mr-1 aside">
                  Suggestions:
                </span>
                {industries.data.suggestions.map((suggestion) => {
                  const pressed = industry === suggestion.toLowerCase()
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() =>
                        setValue("industry", suggestion, {
                          shouldDirty: true,
                          shouldValidate: formState.isSubmitted,
                        })
                      }
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 border px-2.5 text-ui transition-colors duration-(--dur-fast)",
                        pressed
                          ? "border-ink bg-ink font-bold text-paper"
                          : "border-hairline hover:border-ink"
                      )}
                    >
                      {pressed && <Mark name="check" />}
                      {suggestion}
                    </button>
                  )
                })}
              </div>
            ) : null
          }
        >
          {(controlProps) => (
            <Input
              {...controlProps}
              {...register("industry")}
              placeholder="Dentists"
              autoComplete="off"
              className={cn(inputClass, "min-w-0 grow")}
            />
          )}
        </BriefField>

        <BriefField
          label="Your offer"
          required
          error={errors.offer_what?.message}
        >
          {(controlProps) => (
            <Input
              {...controlProps}
              {...register("offer_what")}
              placeholder="Google Ads for dental practices"
              autoComplete="off"
              className={cn(inputClass, "min-w-0 grow")}
            />
          )}
        </BriefField>

        <BriefField
          label="Proof"
          optional
          hint="One result you can point to. The email only uses what you write here."
          error={errors.offer_proof?.message}
        >
          {(controlProps) => (
            <Input
              {...controlProps}
              {...register("offer_proof")}
              placeholder="Grew bookings 30% for a Fairfax practice"
              autoComplete="off"
              className={cn(inputClass, "min-w-0 grow")}
            />
          )}
        </BriefField>

        <BriefField
          label="Ask"
          required
          hint="The one easy next step you'd like them to take."
          error={errors.offer_cta?.message}
          aside={
            <AsideSelect
              label="Tone"
              error={errors.tone?.message}
              {...register("tone")}
            >
              {TONES.map((tone) => (
                <NativeSelectOption key={tone.value} value={tone.value}>
                  {tone.label}
                </NativeSelectOption>
              ))}
            </AsideSelect>
          }
        >
          {(controlProps) => (
            <Input
              {...controlProps}
              {...register("offer_cta")}
              placeholder="Free 15-minute audit"
              autoComplete="off"
              className={cn(inputClass, "min-w-0 grow")}
            />
          )}
        </BriefField>

        <BriefField
          label="How many"
          required
          hint={
            leadsLeft !== null
              ? `${MIN_LEADS} to ${MAX_LEADS} businesses. You have ${plural(leadsLeft, "lead")} left in ${month}.`
              : `${MIN_LEADS} to ${MAX_LEADS} businesses.`
          }
          error={errors.lead_target?.message}
        >
          {(controlProps) => (
            <div className="flex items-center gap-2">
              <Input
                {...controlProps}
                {...register("lead_target", { valueAsNumber: true })}
                type="number"
                inputMode="numeric"
                min={MIN_LEADS}
                max={MAX_LEADS}
                step={1}
                className={cn(inputClass, "w-20 tabular-nums")}
              />
              <span aria-hidden="true" className="text-ui">
                businesses
              </span>
            </div>
          )}
        </BriefField>

        <div className="grid gap-x-6 gap-y-1.5 lg:grid-cols-[7.5rem_minmax(0,1fr)]">
          <span className="text-ui font-bold">Sender</span>
          <p className="min-w-0 text-ui [overflow-wrap:anywhere]">
            {profile ? (
              <>
                {senderLine(profile)}{" "}
                <Link
                  to="/settings"
                  hash="sender-profile"
                  aria-label="Edit sender profile"
                  className="font-semibold underline underline-offset-3 hover:text-edge"
                >
                  (edit)
                </Link>
              </>
            ) : (
              <>
                No sender profile yet.{" "}
                <Link
                  to="/settings"
                  hash="sender-profile"
                  className="font-semibold underline underline-offset-3 hover:text-edge"
                >
                  Add it in Settings
                </Link>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:pl-[calc(7.5rem+1.5rem)]">
          <Button
            type="submit"
            size="lg"
            variant={planned && !stale ? "outline" : "default"}
            disabled={planMutation.isPending}
          >
            {planMutation.isPending
              ? "Reviewing…"
              : planned && !stale
                ? "Review plan again"
                : "Review plan"}
          </Button>
        </div>
      </form>

      <div>
        {planMutation.isPending && (
          <PlanningLine location={current.location} aiName={aiName} />
        )}

        {planMutation.isError && !planFieldError && (
          <PlanError error={planMutation.error} onRetry={() => void review()} />
        )}

        {planned && !planMutation.isPending && (
          <PlanPanel
            plan={planned.plan}
            planLabel={aiLabel("plan")}
            leadTarget={planned.input.lead_target}
            stale={stale}
            answer={answer}
            onAnswer={(value) => {
              setAnswer(value)
              setAnswerError(null)
            }}
            answerError={answerError}
            questionRef={questionRef}
            headingRef={planHeadingRef}
            starting={createMutation.isPending}
            onStart={start}
            onReviewAgain={() => void review()}
            headingLevel={headingLevel}
            startError={
              createMutation.isError ? (
                <StartError
                  error={createMutation.error}
                  onRetry={start}
                  onReviewAgain={() => void review()}
                />
              ) : null
            }
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Errors: calm, in place, always with a way forward
// ---------------------------------------------------------------------------

function SettingsLink({
  hash,
  children,
}: {
  hash: string
  children: React.ReactNode
}) {
  return (
    <Link to="/settings" hash={hash} className={buttonVariants({ variant: "ghost", size: "sm" })}>
      {children}
    </Link>
  )
}

function PlanError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  if (isApiError(error, "profile_required")) {
    return (
      <CalmError
        size="inline"
        title="Add your sender profile first"
        error={error}
        action={
          <SettingsLink hash="sender-profile">Open sender profile</SettingsLink>
        }
      />
    )
  }
  if (isApiError(error, "ai_paused")) {
    return (
      <CalmError
        size="inline"
        title="Planning is paused for now"
        error={error}
        onRetry={onRetry}
      />
    )
  }
  if (
    isApiError(error, "geo_missing") ||
    isApiError(error, "listings_missing")
  ) {
    return (
      <CalmError
        size="inline"
        title="Business listings aren't ready yet"
        error={error}
        onRetry={onRetry}
      />
    )
  }
  return (
    <CalmError
      size="inline"
      title="We couldn't review this plan"
      error={error}
      onRetry={onRetry}
    />
  )
}

function StartError({
  error,
  onRetry,
  onReviewAgain,
}: {
  error: unknown
  onRetry: () => void
  onReviewAgain: () => void
}) {
  if (isApiError(error, "usage_limit")) {
    return (
      <CalmError
        size="inline"
        title="This month's leads are used up"
        error={error}
        action={<SettingsLink hash="usage">See your usage</SettingsLink>}
      />
    )
  }
  if (isApiError(error, "plan_expired") || isApiError(error, "plan_changed")) {
    return (
      <CalmError
        size="inline"
        title="Review the plan again"
        error={error}
        onRetry={onReviewAgain}
        retryLabel="Review plan again"
      />
    )
  }
  if (isApiError(error, "profile_required")) {
    return (
      <CalmError
        size="inline"
        title="Add your sender profile first"
        error={error}
        action={
          <SettingsLink hash="sender-profile">Open sender profile</SettingsLink>
        }
      />
    )
  }
  if (isApiError(error, "ai_paused")) {
    return (
      <CalmError
        size="inline"
        title="Research is paused for now"
        error={error}
        onRetry={onRetry}
      />
    )
  }
  return (
    <CalmError
      size="inline"
      title="We couldn't start this campaign"
      error={error}
      onRetry={onRetry}
    />
  )
}
