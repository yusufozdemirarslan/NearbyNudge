import { zodResolver } from "@hookform/resolvers/zod"
import { Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { CalmError } from "@/components/CalmError"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { qk } from "@/lib/api/queries"
import { notify } from "@/lib/toast"
import { FormField, Section, applyServerErrors, inputClass } from "./form-kit"

const linkClass = "font-medium text-primary underline underline-offset-3 hover:text-foreground"

/** The word to type, so a stray click can't wipe everything. */
const CONFIRM_WORD = "delete"

const schema = z.object({
  confirm: z
    .string()
    .trim()
    .refine((value) => value.toLowerCase() === CONFIRM_WORD, `Type ${CONFIRM_WORD} to confirm.`),
})

/**
 * Delete all data (AC1): in place, no pop-up. Typing "delete" confirms it;
 * campaigns, leads, the do-not-contact list, the sender profile and the
 * preferences are deleted at once, and the app starts over at the sender
 * profile set-up.
 */
export function DeleteDataSection() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const form = useForm<{ confirm: string }>({
    resolver: zodResolver(schema),
    defaultValues: { confirm: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  })
  const { register, handleSubmit, formState, setError, setFocus } = form

  const remove = useMutation({
    mutationFn: (values: { confirm: string }) => api.deleteAccount({ confirm: values.confirm.trim() }),
    onSuccess: async () => {
      // Forget everything cached (the AI status stays), so set-up reads the fresh, empty workspace.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== qk.status()[0] })
      await navigate({ to: "/onboarding" })
      notify({ title: "All data deleted", description: "Set up your sender profile to start again.", type: "success" })
    },
    onError: (error) => {
      applyServerErrors(error, { setError, setFocus }, ["confirm"])
    },
  })

  const onSubmit = handleSubmit((values) => remove.mutate(values))
  const fieldError = formState.errors.confirm?.message

  return (
    <Section
      id="delete-data"
      title="Delete all data"
      description="Start over: this deletes everything in NearbyNudge right now. It can't be undone."
    >
      <div className="flex flex-col gap-5">
        <div className="space-y-2 text-ui text-foreground">
          <p>What's deleted:</p>
          <ul className="ml-5 list-disc space-y-1 text-ink-secondary marker:text-muted-foreground">
            <li>your sender profile and preferences;</li>
            <li>your campaigns, leads, facts, page copies and emails;</li>
            <li>your do-not-contact list.</li>
          </ul>
          <p className="text-ink-secondary">
            Want to keep anything? Export your{" "}
            <Link to="/dnc" className={linkClass}>
              do-not-contact list
            </Link>{" "}
            or your{" "}
            <Link to="/numbers" className={linkClass}>
              numbers
            </Link>{" "}
            first, and each campaign from its review desk.
          </p>
        </div>

        <form
          noValidate
          onSubmit={onSubmit}
          aria-label="Delete all data"
          className="flex flex-col gap-4 rounded-lg border border-[color-mix(in_srgb,var(--destructive)_35%,transparent)] bg-danger-tint p-4"
        >
          <FormField
            label="Type delete to confirm"
            description={
              <>
                Type <span className="font-semibold text-foreground">{CONFIRM_WORD}</span>
              </>
            }
            error={fieldError}
            required
          >
            {(control) => (
              <Input
                {...control}
                {...register("confirm")}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className={`${inputClass} bg-card dark:bg-card`}
              />
            )}
          </FormField>
          {remove.isError && !fieldError && (
            <CalmError size="inline" title="We couldn't delete your data" error={remove.error} onRetry={() => void onSubmit()} />
          )}
          <Button type="submit" variant="destructive" className="w-fit" disabled={remove.isPending}>
            {remove.isPending ? "Deleting everything…" : "Delete all data"}
          </Button>
        </form>
      </div>
    </Section>
  )
}
