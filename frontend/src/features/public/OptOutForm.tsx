import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { CalmError } from "@/components/CalmError"
import { Mark } from "@/components/Mark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAnnounce } from "@/hooks/use-announce"
import { api, isApiError } from "@/lib/api"
import {
  FormField,
  applyServerErrors,
  inputClass,
} from "@/features/settings/form-kit"
import { EMAIL_PATTERN, displayHost, looksLikeDomain } from "./domains"

const schema = z.object({
  domain: z
    .string()
    .trim()
    .min(1, "Enter your website's address, such as example.com.")
    .max(300, "Use 300 characters or fewer.")
    .refine(looksLikeDomain, "Enter a website address, such as example.com."),
  email: z
    .string()
    .trim()
    .min(1, "Enter an email address we can reach you at.")
    .max(320, "Use 320 characters or fewer.")
    .refine(
      (value) => EMAIL_PATTERN.test(value),
      "Enter an email address, such as you@example.com."
    ),
  note: z.string().trim().max(1000, "Use 1,000 characters or fewer."),
})

type Values = z.infer<typeof schema>

const ORDER: (keyof Values)[] = ["domain", "email", "note"]

/**
 * The site-owner opt-out (POST /api/public/optout), open to anyone. On
 * success the form is replaced by the server's confirmation, which gets focus.
 */
export function OptOutForm() {
  const announce = useAnnounce()
  const [done, setDone] = React.useState<{
    domain: string
    message: string
  } | null>(null)
  const confirmationRef = React.useRef<HTMLHeadingElement>(null)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { domain: "", email: "", note: "" },
  })
  const { register, handleSubmit, formState, setError, setFocus, reset } = form
  const errors = formState.errors

  const mutation = useMutation({
    mutationFn: (values: Values) =>
      api.publicOptOut({
        domain: values.domain,
        email: values.email,
        note: values.note || undefined,
      }),
    onSuccess: (response, values) => {
      const message =
        response.message ??
        "Thanks. NearbyNudgeBot will stop reading this site within 2 business days."
      setDone({ domain: displayHost(values.domain), message })
      announce(message)
    },
    onError: (error) => {
      applyServerErrors(error, { setError, setFocus }, ORDER, {
        aliases: { contact_email: "email" },
      })
    },
  })

  React.useEffect(() => {
    if (done) confirmationRef.current?.focus()
  }, [done])

  if (done) {
    return (
      <div
        className="flex flex-col gap-3 border-2 border-ink p-5 sm:p-6"
        data-testid="optout-confirmation"
      >
        <h4
          ref={confirmationRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-lead font-bold outline-none"
        >
          <Mark name="check" />
          Request received for {done.domain}
        </h4>
        <p className="text-ui">{done.message}</p>
        <div>
          <Button
            variant="outline"
            onClick={() => {
              reset()
              mutation.reset()
              setDone(null)
              window.setTimeout(() => setFocus("domain"), 0)
            }}
          >
            Send another request
          </Button>
        </div>
      </div>
    )
  }

  const fieldErrors = Object.keys(errors).length > 0
  const rateLimited = isApiError(mutation.error, "rate_limited")

  return (
    <form
      noValidate
      aria-label="Opt-out request"
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="flex flex-col gap-5 border-2 border-dashed border-ink p-5 text-ui sm:p-6"
    >
      <FormField
        label="Your website"
        description="Its address, such as example.com. This covers every page on the site."
        error={errors.domain?.message}
        required
      >
        {(control) => (
          <Input
            {...control}
            {...register("domain")}
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="example.com"
            className={inputClass}
          />
        )}
      </FormField>
      <FormField
        label="Your email"
        description="We use it only to confirm the request or ask about it."
        error={errors.email?.message}
        required
      >
        {(control) => (
          <Input
            {...control}
            {...register("email")}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            className={inputClass}
          />
        )}
      </FormField>
      <FormField
        label="Anything we should know"
        optional
        error={errors.note?.message}
      >
        {(control) => (
          <Textarea
            {...control}
            {...register("note")}
            rows={3}
            className="text-body md:text-ui"
          />
        )}
      </FormField>

      {mutation.isError && !fieldErrors && (
        <CalmError
          size="inline"
          title={
            rateLimited
              ? "We couldn't take another request yet"
              : "We couldn't send your request"
          }
          message={
            rateLimited
              ? "This network has sent several requests in the last hour. Please try again later. The robots.txt lines above work without waiting."
              : undefined
          }
          error={mutation.error}
          onRetry={
            rateLimited
              ? undefined
              : () => void handleSubmit((values) => mutation.mutate(values))()
          }
        />
      )}

      <div>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Sending…" : "Send opt-out request"}
        </Button>
      </div>
    </form>
  )
}
