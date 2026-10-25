import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { CalmError } from "@/components/CalmError"
import { Mark } from "@/components/Mark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAnnounce } from "@/hooks/use-announce"
import { api, isApiError } from "@/lib/api"
import { qk } from "@/lib/api/queries"
import type { DncEntry } from "@/lib/api/types"
import {
  FieldMessage,
  FormField,
  Section,
  applyServerErrors,
  inputClass,
} from "@/features/settings/form-kit"
import { EMAIL_PATTERN, looksLikeDomain } from "@/features/public/domains"
import { addToCaches, entryLabel } from "./entries"

const schema = z.object({
  business_name: z.string().trim().max(300, "Use 300 characters or fewer."),
  domain: z
    .string()
    .trim()
    .max(300, "Use 300 characters or fewer.")
    .refine(
      (value) => !value || looksLikeDomain(value),
      "Enter a website address, such as example.com."
    ),
  email: z
    .string()
    .trim()
    .max(320, "Use 320 characters or fewer.")
    .refine(
      (value) => !value || EMAIL_PATTERN.test(value),
      "Enter an email address, such as name@example.com."
    ),
  reason: z.string().trim().max(300, "Use 300 characters or fewer."),
})

type Values = z.infer<typeof schema>

const ORDER: (keyof Values)[] = ["business_name", "domain", "email", "reason"]
const NEED_ONE = "Add a business name, a website or an email address."

/**
 * Adds an entry to the do-not-contact list (POST /api/dnc). At least one of
 * name, website and email is required; the message for that sits under the
 * three fields and is linked to each of them.
 */
export function AddEntryForm({
  onAdded,
}: {
  onAdded: (entry: DncEntry) => void
}) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const groupErrorId = React.useId()
  const [groupError, setGroupError] = React.useState<string | null>(null)
  const [added, setAdded] = React.useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { business_name: "", domain: "", email: "", reason: "" },
  })
  const {
    register,
    handleSubmit,
    formState,
    setError,
    setFocus,
    reset,
    subscribe,
  } = form
  const errors = formState.errors

  // Typing in any of the three fields clears the "add at least one" message.
  React.useEffect(
    () =>
      subscribe({
        formState: { values: true },
        callback: ({ values, name }) => {
          if (!name) return
          setAdded(null)
          if (
            name !== "reason" &&
            (values.business_name || values.domain || values.email)
          )
            setGroupError(null)
        },
      }),
    [subscribe]
  )

  const mutation = useMutation({
    mutationFn: (values: Values) =>
      api.createDnc({
        business_name: values.business_name || undefined,
        domain: values.domain || undefined,
        email: values.email || undefined,
        reason: values.reason || undefined,
      }),
    onSuccess: (entry) => {
      addToCaches(queryClient, entry)
      void queryClient.invalidateQueries({ queryKey: qk.dncAll() })
      const label = entryLabel(entry)
      reset()
      setAdded(label)
      announce(`Added ${label} to your Do not contact list`)
      onAdded(entry)
      window.setTimeout(() => setFocus("business_name"), 0)
    },
    onError: (error) => {
      const placed = applyServerErrors(error, { setError, setFocus }, ORDER)
      if (!placed && isApiError(error, "validation")) {
        setGroupError(error.message)
        setFocus("business_name")
      }
    },
  })

  const onSubmit = handleSubmit((values) => {
    if (!values.business_name && !values.domain && !values.email) {
      setGroupError(NEED_ONE)
      setFocus("business_name")
      return
    }
    setGroupError(null)
    mutation.mutate(values)
  })

  /** The three identity fields also point at the shared "add at least one" message. */
  const withGroup = (control: {
    "aria-describedby"?: string
    "aria-invalid"?: true
  }) => ({
    "aria-describedby":
      [control["aria-describedby"], groupError ? groupErrorId : null]
        .filter(Boolean)
        .join(" ") || undefined,
    "aria-invalid":
      control["aria-invalid"] ?? (groupError ? (true as const) : undefined),
  })

  const generalError =
    mutation.isError && !isApiError(mutation.error, "validation")
      ? mutation.error
      : null

  return (
    <Section
      title="Add to the list"
      description="A business name, a website or an email address is enough. NearbyNudge never drafts an email to anything that matches."
    >
      <form
        noValidate
        onSubmit={onSubmit}
        aria-label="Add to the Do not contact list"
        className="flex flex-col gap-5"
      >
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="sr-only">Who to add (at least one)</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              label="Business name"
              error={errors.business_name?.message}
            >
              {(control) => (
                <Input
                  {...control}
                  {...withGroup(control)}
                  {...register("business_name")}
                  autoComplete="off"
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField label="Website" error={errors.domain?.message}>
              {(control) => (
                <Input
                  {...control}
                  {...withGroup(control)}
                  {...register("domain")}
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="example.com"
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField label="Email" error={errors.email?.message}>
              {(control) => (
                <Input
                  {...control}
                  {...withGroup(control)}
                  {...register("email")}
                  type="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="name@example.com"
                  className={inputClass}
                />
              )}
            </FormField>
          </div>
          {groupError && (
            <FieldMessage id={groupErrorId}>{groupError}</FieldMessage>
          )}
        </fieldset>

        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <FormField label="Reason" optional error={errors.reason?.message}>
            {(control) => (
              <Input
                {...control}
                {...register("reason")}
                autoComplete="off"
                placeholder="For example, already a client"
                className={inputClass}
              />
            )}
          </FormField>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="w-fit max-sm:h-11"
          >
            {mutation.isPending ? "Adding…" : "Add to list"}
          </Button>
        </div>

        {generalError ? (
          <CalmError
            size="inline"
            title="We couldn't add this"
            error={generalError}
            onRetry={() => void onSubmit()}
          />
        ) : null}
        {added && (
          <p className="flex items-center gap-1.5 text-ui font-semibold">
            <Mark name="check" />
            Added {added}.
          </p>
        )}
      </form>
    </Section>
  )
}
