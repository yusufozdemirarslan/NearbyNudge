import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearch } from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { CalmError } from "@/components/CalmError"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { api, isApiError } from "@/lib/api"
import { FormField, applyServerErrors, inputClass } from "@/features/settings/form-kit"
import { safeRedirect } from "@/lib/redirect"

const schema = z.object({
  email: z.string().trim().min(1, "Enter the account's email address.").max(320, "Use 320 characters or fewer."),
  password: z.string().min(1, "Enter the password.").max(200, "Use 200 characters or fewer."),
})

type LoginValues = z.infer<typeof schema>

/**
 * Sign-in for the one account (there is no sign-up). Shown only when this copy
 * asks for sign-in; afterwards it continues to the page that sent the browser
 * here (`redirect`, checked by the route), or to campaigns.
 */
export function LoginPage() {
  useDocumentTitle("Sign in")
  const router = useRouter()
  const queryClient = useQueryClient()
  const { redirect } = useSearch({ strict: false }) as { redirect?: string }
  const [showPassword, setShowPassword] = React.useState(false)
  const form = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  })
  const { register, handleSubmit, formState, setError, setFocus } = form
  const errors = formState.errors

  React.useEffect(() => setFocus("email"), [setFocus])

  const mutation = useMutation({
    mutationFn: (values: LoginValues) => api.login(values),
    onSuccess: async () => {
      // Everything cached while signed out (refused requests) is stale now.
      queryClient.clear()
      await router.navigate({ href: safeRedirect(redirect) ?? "/", replace: true })
    },
    onError: (error) => {
      if (isApiError(error, "bad_credentials")) {
        applyServerErrors(error, { setError, setFocus }, ["email", "password"])
      }
    },
  })

  const onSubmit = handleSubmit((values) => mutation.mutate(values))
  const showPanel = mutation.isError && !isApiError(mutation.error, "bad_credentials")

  return (
    <>
      <PageHeader title="Sign in" description="Use the email address and password of this copy's account." />
      <form noValidate onSubmit={onSubmit} aria-label="Sign in" className="flex min-w-0 flex-col gap-5">
        <FormField label="Email address" error={errors.email?.message} required>
          {(control) => (
            <Input
              {...control}
              {...register("email")}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className={inputClass}
            />
          )}
        </FormField>
        <FormField
          label="Password"
          error={errors.password?.message}
          required
          after={
            <Button
              type="button"
              variant="link"
              size="sm"
              className="w-fit px-0"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? "Hide password" : "Show password"}
            </Button>
          }
        >
          {(control) => (
            <Input
              {...control}
              {...register("password")}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="none"
              spellCheck={false}
              className={inputClass}
            />
          )}
        </FormField>

        {showPanel && (
          <CalmError size="inline" title="We couldn't sign you in" error={mutation.error} onRetry={() => void onSubmit()} />
        )}

        <div className="flex flex-col items-start gap-3">
          <Button type="submit" size="lg" disabled={mutation.isPending}>
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="max-w-measure aside">This copy of NearbyNudge has one account, set up by its owner. There&rsquo;s no sign-up.</p>
        </div>
      </form>
    </>
  )
}
