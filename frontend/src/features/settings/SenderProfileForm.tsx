import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Controller, useForm, useWatch } from "react-hook-form"
import { z } from "zod"
import { CalmError } from "@/components/CalmError"
import { Mark } from "@/components/Mark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { useAnnounce } from "@/hooks/use-announce"
import { api } from "@/lib/api"
import { qk } from "@/lib/api/queries"
import type { Account, SenderProfile, Tone } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { footerLines } from "./footer"
import { FormField, applyServerErrors, inputClass } from "./form-kit"

export const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: "professional", label: "Professional", hint: "Polite and businesslike" },
  { value: "friendly", label: "Friendly", hint: "Warm and conversational" },
  { value: "direct", label: "Direct", hint: "Short and to the point" },
]

const US_TIME_ZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern time (New York)" },
  { value: "America/Chicago", label: "Central time (Chicago)" },
  { value: "America/Denver", label: "Mountain time (Denver)" },
  { value: "America/Phoenix", label: "Arizona time (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific time (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska time (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii time (Honolulu)" },
]

/** The browser's IANA time zone ("America/New_York"), used to pre-fill the profile. */
export function detectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  } catch {
    return "America/New_York"
  }
}

function otherTimeZones(current: string): string[] {
  let all: string[]
  try {
    all = Intl.supportedValuesOf("timeZone")
  } catch {
    all = []
  }
  const us = new Set(US_TIME_ZONES.map((zone) => zone.value))
  const rest = all.filter((zone) => !us.has(zone))
  if (current && !us.has(current) && !rest.includes(current)) rest.unshift(current)
  return rest
}

const schema = z.object({
  sender_name: z
    .string()
    .trim()
    .min(1, "Enter your name as it should appear in emails.")
    .max(120, "Use 120 characters or fewer."),
  sender_title: z.string().trim().max(120, "Use 120 characters or fewer."),
  sender_company: z.string().trim().min(1, "Enter your company's name.").max(160, "Use 160 characters or fewer."),
  sender_address: z
    .string()
    .trim()
    .min(5, "Enter your full postal address, including the city, state and ZIP code.")
    .max(300, "Use 300 characters or fewer."),
  default_tone: z.enum(["professional", "friendly", "direct"]),
  timezone: z.string().min(1, "Choose your time zone."),
})

export type SenderProfileValues = z.infer<typeof schema>

const FIELD_ORDER: (keyof SenderProfileValues)[] = [
  "sender_name",
  "sender_title",
  "sender_company",
  "sender_address",
  "default_tone",
  "timezone",
]

export function profileDefaults(profile: SenderProfile | null): SenderProfileValues {
  return {
    sender_name: profile?.sender_name ?? "",
    sender_title: profile?.sender_title ?? "",
    sender_company: profile?.sender_company ?? "",
    sender_address: profile?.sender_address ?? "",
    default_tone: profile?.default_tone ?? "professional",
    timezone: profile?.timezone || detectedTimeZone(),
  }
}

export interface SenderProfileFormProps {
  /** Saved profile, or null on first set-up. */
  profile: SenderProfile | null
  /** The server's footer for the saved profile (Account.footer_preview). */
  savedFooter?: string | null
  submitLabel: string
  /** Heading level of the footer preview: 2 on its own page, 3 inside a section. */
  headingLevel?: 2 | 3
  autoFocus?: boolean
  /** Called with the updated account after a successful save. */
  onSaved?: (account: Account) => void | Promise<void>
}

/**
 * The sender profile (name, title, company, postal address, default tone,
 * time zone) with a live preview of the locked email footer, placed right
 * after the fields it is built from. Used by onboarding and Settings. Saving
 * updates the account and the workspace (`onboarded`) in the cache.
 */
export function SenderProfileForm({
  profile,
  savedFooter,
  submitLabel,
  headingLevel = 3,
  autoFocus = false,
  onSaved,
}: SenderProfileFormProps) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const ids = React.useId()
  const [justSaved, setJustSaved] = React.useState(false)
  const form = useForm<SenderProfileValues>({
    resolver: zodResolver(schema),
    defaultValues: profileDefaults(profile),
    mode: "onSubmit",
    reValidateMode: "onChange",
  })
  const { register, handleSubmit, control, formState, setError, setFocus, reset } = form
  const errors = formState.errors

  React.useEffect(() => {
    if (autoFocus) setFocus("sender_name")
  }, [autoFocus, setFocus])

  const mutation = useMutation({
    mutationFn: (values: SenderProfileValues) => api.updateProfile(values),
    onSuccess: async (account, values) => {
      queryClient.setQueryData(qk.account(), account)
      queryClient.setQueryData(qk.me(), { user: account.user })
      // Drafts show the footer, so cached leads are out of date now.
      void queryClient.invalidateQueries({ queryKey: qk.leads() })
      reset(account.profile ? profileDefaults(account.profile) : values)
      setJustSaved(true)
      announce("Sender profile saved")
      await onSaved?.(account)
    },
    onError: (error) => {
      applyServerErrors(error, { setError, setFocus }, FIELD_ORDER)
    },
  })

  const values = useWatch({ control })
  const dirty = formState.isDirty
  const showServerFooter = !dirty && Boolean(savedFooter)
  const hasFieldErrors = Object.keys(errors).length > 0
  const zones = React.useMemo(() => otherTimeZones(values.timezone ?? ""), [values.timezone])
  const toneLegendId = `${ids}-tone`
  const toneHintId = `${ids}-tone-hint`

  const onSubmit = handleSubmit((data) => mutation.mutate(data))

  return (
    <form noValidate onSubmit={onSubmit} aria-label="Sender profile" className="@container min-w-0">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="grid gap-5 @md:grid-cols-2">
          <FormField label="Your name" error={errors.sender_name?.message} required>
            {(control) => <Input {...control} {...register("sender_name")} autoComplete="name" className={inputClass} />}
          </FormField>
          <FormField label="Job title" optional error={errors.sender_title?.message}>
            {(control) => (
              <Input {...control} {...register("sender_title")} autoComplete="organization-title" className={inputClass} />
            )}
          </FormField>
        </div>
        <FormField label="Company" error={errors.sender_company?.message} required>
          {(control) => (
            <Input {...control} {...register("sender_company")} autoComplete="organization" className={inputClass} />
          )}
        </FormField>
        <FormField
          label="Postal address"
          description="Required by the CAN-SPAM Act; it appears in every email footer. A street address or a registered PO box both work."
          error={errors.sender_address?.message}
          required
        >
          {(control) => (
            <Textarea
              {...control}
              {...register("sender_address")}
              rows={3}
              autoComplete="street-address"
              className="min-h-24 text-body md:text-ui"
            />
          )}
        </FormField>

        <FooterPreview
          headingLevel={headingLevel}
          serverText={showServerFooter ? savedFooter : null}
          values={{
            sender_name: values.sender_name ?? "",
            sender_title: values.sender_title ?? "",
            sender_company: values.sender_company ?? "",
            sender_address: values.sender_address ?? "",
          }}
          unsaved={dirty && Boolean(savedFooter)}
        />

        <Controller
          control={control}
          name="default_tone"
          render={({ field }) => (
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend id={toneLegendId} className="mb-1.5 text-ui font-bold">
                Default tone
              </legend>
              <p id={toneHintId} className="-mt-1 mb-1 aside">
                New campaigns start with this tone. You can change it for each campaign.
              </p>
              <RadioGroup
                value={field.value}
                onValueChange={(value) => field.onChange(value as Tone)}
                aria-labelledby={toneLegendId}
                aria-describedby={toneHintId}
                className="grid gap-2 @xl:grid-cols-3"
              >
                {TONES.map((tone) => (
                  <label
                    key={tone.value}
                    className="flex min-h-11 cursor-pointer items-start gap-2.5 px-3 py-2.5 border border-ink transition-colors duration-(--dur-fast) hover:bg-tint has-data-checked:outline-2 has-data-checked:outline-ink has-data-checked:-outline-offset-2"
                  >
                    <RadioGroupItem value={tone.value} className="mt-0.5" />
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 @xl:flex-col @xl:items-start">
                      <span className="text-ui font-bold">{tone.label}</span>
                      <span className="aside">{tone.hint}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
          )}
        />
        <FormField
          label="Time zone"
          description="Your daily sending limit resets at midnight in this time zone."
          error={errors.timezone?.message}
          required
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...register("timezone")}
              className="w-full @md:max-w-sm [&_select]:text-body md:[&_select]:text-ui"
            >
              <NativeSelectOptGroup label="United States">
                {US_TIME_ZONES.map((zone) => (
                  <NativeSelectOption key={zone.value} value={zone.value}>
                    {zone.label}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
              {zones.length > 0 && (
                <NativeSelectOptGroup label="All time zones">
                  {zones.map((zone) => (
                    <NativeSelectOption key={zone} value={zone}>
                      {zone.replace(/_/gu, " ")}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
              )}
            </NativeSelect>
          )}
        </FormField>
      </div>

      {mutation.isError && !hasFieldErrors && (
        <CalmError
          size="inline"
          className="mt-6"
          title="We couldn't save your sender profile"
          error={mutation.error}
          onRetry={() => void onSubmit()}
        />
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : submitLabel}
        </Button>
        {justSaved && !dirty && (
          <span className="inline-flex items-center gap-1.5 text-ui font-semibold">
            <Mark name="check" />
            Saved
          </span>
        )}
      </div>
    </form>
  )
}

/**
 * The locked footer as recipients will see it. Before saving it is built
 * here from the form; after saving it shows the server's `footer_preview`.
 */
export function FooterPreview({
  values,
  serverText,
  unsaved = false,
  headingLevel = 3,
  className,
}: {
  values: { sender_name: string; sender_title: string; sender_company: string; sender_address: string }
  serverText?: string | null
  unsaved?: boolean
  headingLevel?: 2 | 3
  className?: string
}) {
  const titleId = React.useId()
  const lines = footerLines(values)
  const Heading = headingLevel === 2 ? "h2" : "h3"
  return (
    <section aria-labelledby={titleId} className={cn("min-w-0", className)}>
      <Heading id={titleId} className="mb-2 flex items-center gap-1.5 text-ui font-bold">
        <Mark name="lock" />
        Your email footer
      </Heading>
      <div className="border-2 border-ink px-5 py-4 sm:px-6 sm:py-5" data-testid="footer-preview">
        {serverText ? (
          <p className="text-body whitespace-pre-line [overflow-wrap:anywhere]">{serverText}</p>
        ) : (
          <p className="text-body [overflow-wrap:anywhere]">
            {lines.map((line) =>
              line.text === null ? (
                <span key={line.key} className="flex items-baseline gap-2 italic">
                  <span className="min-w-0">{line.placeholder}</span>
                  <span aria-hidden="true" className="leader" />
                </span>
              ) : (
                <span key={line.key} className="block">
                  {line.text || "\u00a0"}
                </span>
              )
            )}
          </p>
        )}
      </div>
      <p className="mt-2 aside">
        {unsaved
          ? "Preview of your changes. Save to use it in new and existing drafts."
          : "NearbyNudge adds this to every email. It can only be changed here."}
      </p>
    </section>
  )
}
