import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { CalmError } from "@/components/CalmError"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAnnounce } from "@/hooks/use-announce"
import { api } from "@/lib/api"
import { qk } from "@/lib/api/queries"
import type { OptOut } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { FormField, Section, applyServerErrors, inputClass } from "@/features/settings/form-kit"
import { DataTable, td, th } from "@/features/numbers/viz"
import { optOutsQuery } from "./queries"

const schema = z.object({
  domain: z
    .string()
    .trim()
    .min(1, "Enter the site's domain, like example.com.")
    .refine((value) => /^[^\s@]+\.[^\s@]{2,}$/u.test(value.replace(/^https?:\/\//iu, "").replace(/\/.*$/u, "")), {
      message: "Enter a website domain, like example.com.",
    }),
  contact_email: z
    .string()
    .trim()
    .refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value), {
      message: "Enter an email address like owner@example.com, or leave it empty.",
    }),
  note: z.string().trim().max(500, "Use 500 characters or fewer."),
})
type Values = z.infer<typeof schema>

function OptOutRow({ optOut }: { optOut: OptOut }) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const [confirming, setConfirming] = React.useState(false)
  const keepRef = React.useRef<HTMLButtonElement>(null)
  const removeRef = React.useRef<HTMLButtonElement>(null)
  const remove = useMutation({
    mutationFn: () => api.deleteOptOut(optOut.id),
    onSuccess: async () => {
      announce(`Removed the opt-out for ${optOut.domain}`)
      await queryClient.invalidateQueries({ queryKey: qk.admin.optOuts() })
      // The row is gone; keep keyboard focus in this section.
      document.querySelector<HTMLElement>("#optouts h2")?.focus()
    },
  })
  React.useEffect(() => {
    if (confirming) keepRef.current?.focus()
  }, [confirming])
  return (
    <tr>
      <th scope="row" className={`${td} font-semibold [overflow-wrap:anywhere]`}>
        {optOut.domain}
      </th>
      <td className={`${td} [overflow-wrap:anywhere]`}>{optOut.contact_email ?? <span className="aside">None</span>}</td>
      <td className={`${td} min-w-40 [overflow-wrap:anywhere]`}>{optOut.note ?? <span className="aside">None</span>}</td>
      <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDate(optOut.created_at)}</td>
      <td className={`${td} text-right`}>
        {confirming ? (
          <div className="flex min-w-64 flex-col items-end gap-2">
            <p className="aside">NearbyNudgeBot may read {optOut.domain} again.</p>
            <div className="flex gap-2">
              <Button
                ref={keepRef}
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirming(false)
                  window.setTimeout(() => removeRef.current?.focus(), 0)
                }}
              >
                Keep it
              </Button>
              <Button
                variant="destructive-soft"
                size="sm"
                aria-disabled={remove.isPending || undefined}
                onClick={() => {
                  if (!remove.isPending) remove.mutate()
                }}
              >
                {remove.isPending ? "Removing…" : "Remove opt-out"}
              </Button>
            </div>
            {remove.isError && <p className="text-meta font-semibold text-edge">We couldn't remove it. Please try again.</p>}
          </div>
        ) : (
          <Button ref={removeRef} variant="link" size="sm" className="h-6 px-1" onClick={() => setConfirming(true)}>
            Remove<span className="sr-only"> the opt-out for {optOut.domain}</span>
          </Button>
        )}
      </td>
    </tr>
  )
}

export function OptOutsSection() {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const optOuts = useQuery(optOutsQuery())
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { domain: "", contact_email: "", note: "" } })
  const { register, handleSubmit, formState, setError, setFocus, reset } = form
  const errors = formState.errors
  const add = useMutation({
    mutationFn: (values: Values) =>
      api.createOptOut({
        domain: values.domain,
        contact_email: values.contact_email || undefined,
        note: values.note || undefined,
      }),
    onSuccess: (row) => {
      reset()
      announce(`Added an opt-out for ${row.domain}`)
      void queryClient.invalidateQueries({ queryKey: qk.admin.optOuts() })
    },
    onError: (error) => applyServerErrors(error, { setError, setFocus }, ["domain", "contact_email", "note"]),
  })
  const onSubmit = handleSubmit((values) => {
    if (!add.isPending) add.mutate(values)
  })
  const fieldErrors = Boolean(errors.domain || errors.contact_email || errors.note)

  return (
    <Section
      id="optouts"
      title="Site-owner opt-outs"
      description="Sites whose owners asked NearbyNudgeBot to stay away, from the public form on the bot page or added here. The reader skips them for every user."
    >
      <form noValidate onSubmit={onSubmit} aria-label="Add a site-owner opt-out" className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <FormField label="Website domain" error={errors.domain?.message} required>
          {(control) => (
            <Input {...control} {...register("domain")} placeholder="example.com" autoComplete="off" spellCheck={false} className={inputClass} />
          )}
        </FormField>
        <FormField label="Owner's email" optional error={errors.contact_email?.message}>
          {(control) => (
            <Input {...control} {...register("contact_email")} type="email" autoComplete="off" className={inputClass} />
          )}
        </FormField>
        <FormField label="Note" optional error={errors.note?.message} className="md:col-span-2">
          {(control) => <Input {...control} {...register("note")} autoComplete="off" className={inputClass} />}
        </FormField>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button type="submit" aria-disabled={add.isPending || undefined}>
            {add.isPending ? "Adding…" : "Add opt-out"}
          </Button>
        </div>
        {add.isError && !fieldErrors && (
          <CalmError size="inline" className="md:col-span-2" title="We couldn't add the opt-out" error={add.error} onRetry={() => void onSubmit()} />
        )}
      </form>

      <div className="mt-8">
        {optOuts.isPending ? (
          <div aria-hidden="true" className="space-y-3">
            <PlaceholderBar width="60%" />
            <PlaceholderBar width="45%" />
          </div>
        ) : optOuts.isError ? (
          <CalmError size="inline" title="We couldn't load the opt-outs" error={optOuts.error} onRetry={() => void optOuts.refetch()} />
        ) : optOuts.data.length === 0 ? (
          <p className="aside">No site owners have opted out.</p>
        ) : (
          <DataTable label="Site-owner opt-outs">
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Domain
                </th>
                <th scope="col" className={th}>
                  Owner's email
                </th>
                <th scope="col" className={th}>
                  Note
                </th>
                <th scope="col" className={th}>
                  Added
                </th>
                <th scope="col" className={`${th} text-right`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {optOuts.data.map((optOut) => (
                <OptOutRow key={optOut.id} optOut={optOut} />
              ))}
            </tbody>
          </DataTable>
        )}
      </div>
    </Section>
  )
}
