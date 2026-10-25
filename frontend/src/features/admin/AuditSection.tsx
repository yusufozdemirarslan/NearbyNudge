import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalmError } from "@/components/CalmError"
import { Mark } from "@/components/Mark"
import { EmptyState } from "@/components/EmptyState"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { Button } from "@/components/ui/button"
import { useAnnounce } from "@/hooks/use-announce"
import { api } from "@/lib/api"
import { qk } from "@/lib/api/queries"
import type { AuditFact, AuditLead } from "@/lib/api/types"
import { displayDomain, formatDate, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Section } from "@/features/settings/form-kit"
import { StatusWord } from "./parts"
import { AUDIT_SAMPLE_SIZE, auditSampleQuery } from "./queries"

type Verdict = NonNullable<AuditFact["verdict"]>

function setVerdictInCache(leads: AuditLead[] | undefined, factId: string, verdict: Verdict | null) {
  return leads?.map((lead) => ({
    ...lead,
    facts: lead.facts.map((item) => (item.fact.id === factId ? { ...item, verdict } : item)),
  }))
}

function VerdictButtons({ item, leadName }: { item: AuditFact; leadName: string }) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const key = qk.admin.audit(AUDIT_SAMPLE_SIZE)
  const save = useMutation({
    mutationFn: (verdict: Verdict) => api.setAuditVerdict(item.fact.id, { verdict }),
    onMutate: async (verdict) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = item.verdict
      queryClient.setQueryData<AuditLead[]>(key, (leads) => setVerdictInCache(leads, item.fact.id, verdict))
      return { previous }
    },
    onError: (_error, _verdict, context) => {
      queryClient.setQueryData<AuditLead[]>(key, (leads) => setVerdictInCache(leads, item.fact.id, context?.previous ?? null))
    },
    onSuccess: (_result, verdict) => {
      announce(verdict === "supported" ? "Marked supported" : "Marked not supported")
      // Quality numbers count audited facts.
      void queryClient.invalidateQueries({ queryKey: qk.admin.overview() })
    },
  })
  const button =
    "inline-flex h-9 items-center gap-1.5 border-2 border-ink px-3 text-ui font-semibold transition-colors duration-(--dur-fast) hover:underline underline-offset-[5px] aria-disabled:border-dashed aria-disabled:text-ink-soft"
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div role="group" aria-label={`Verdict for this fact about ${leadName}`} className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={item.verdict === "supported"}
          aria-disabled={save.isPending || undefined}
          onClick={() => {
            if (!save.isPending) save.mutate("supported")
          }}
          className={cn(button, "aria-pressed:bg-ink aria-pressed:text-paper")}
        >
          {item.verdict === "supported" && <Mark name="check" />}
          Supported
        </button>
        <button
          type="button"
          aria-pressed={item.verdict === "not_supported"}
          aria-disabled={save.isPending || undefined}
          onClick={() => {
            if (!save.isPending) save.mutate("not_supported")
          }}
          className={cn(button, "aria-pressed:border-edge aria-pressed:bg-edge aria-pressed:text-edge-ink")}
        >
          {item.verdict === "not_supported" && <Mark name="cross" />}
          Not supported
        </button>
      </div>
      {save.isError && (
        <p className="text-meta font-semibold text-edge" role="alert">
          We couldn't save that verdict. Choose it again to retry.
        </p>
      )}
    </div>
  )
}

function FactSource({ item }: { item: AuditFact }) {
  const { fact } = item
  const href = fact.fragment_url ?? fact.url
  const text = `${fact.source_label}, ${formatDate(fact.seen_at)}`
  if (fact.source_kind === "listing" || !href) {
    return (
      <span className="aside">{text}</span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-meta font-semibold underline underline-offset-[3px] hover:text-edge"
    >
      {text}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function AuditLeadCard({ lead, defaultOpen }: { lead: AuditLead; defaultOpen: boolean }) {
  const reviewed = lead.facts.filter((item) => item.verdict !== null).length
  return (
    <details open={defaultOpen} className="group border-b border-hairline">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-x-4 gap-y-1 py-4 hover:bg-tint [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-start gap-2.5">
          <Mark
            name="pointer"
            className="mt-[7px] transition-transform duration-(--dur-fast) group-open:rotate-90 group-open:text-edge"
          />
          <span className="min-w-0">
            <span className="block text-lead font-bold">{lead.name}</span>
            <span className="block aside">{lead.campaign_name}</span>
          </span>
        </span>
        <span className="pl-5.5 text-meta tabular-nums sm:pl-0">
          {reviewed === lead.facts.length && reviewed > 0 ? (
            <StatusWord tone="good">All {plural(lead.facts.length, "fact")} reviewed</StatusWord>
          ) : (
            <>
              {reviewed} of {plural(lead.facts.length, "fact")} reviewed
            </>
          )}
        </span>
      </summary>
      <div className="pb-5 pl-5.5">
        <p className="text-meta">
          {lead.website ? (
            <a
              href={lead.website}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-[3px] hover:text-edge"
            >
              {displayDomain(lead.website)}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            "No website"
          )}
          {lead.email_subject && <span className="italic">. Subject: {lead.email_subject}</span>}
        </p>
        {lead.facts.length === 0 ? (
          <p className="mt-3 aside">This lead has no recorded facts.</p>
        ) : (
          <ol className="mt-3 divide-y">
            {lead.facts.map((item, index) => (
              <li key={item.fact.id} className="grid gap-2 py-3.5 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:gap-6">
                <div className="min-w-0 space-y-1.5">
                  <p className="text-ui">
                    <sup className="mr-1 numeral text-meta">{index + 1}</sup>
                    {item.fact.text}
                  </p>
                  <blockquote className="border-l border-ink pl-3 text-ui italic">
                    “{item.fact.quote}”
                  </blockquote>
                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <FactSource item={item} />
                    {!item.fact.quote_found && item.fact.source_kind !== "listing" && (
                      <span className="inline-flex items-center gap-1.5 text-meta font-semibold text-edge">
                        <Mark name="asterisk" />
                        Quote not found in our saved copy
                      </span>
                    )}
                    <span className="aside">
                      Editor: {item.fact.state === "supported" ? "supported" : "check"}
                    </span>
                  </p>
                </div>
                <VerdictButtons item={item} leadName={lead.name} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  )
}

export function AuditSection() {
  const audit = useQuery(auditSampleQuery())
  const leads = audit.data ?? []
  const totalFacts = leads.reduce((n, lead) => n + lead.facts.length, 0)
  const reviewed = leads.reduce((n, lead) => n + lead.facts.filter((item) => item.verdict !== null).length, 0)
  return (
    <Section
      id="audit"
      title="Audit sample"
      description="A random sample of leads from the last 30 days. Check each fact against its quote and page: is the fact really supported? Your verdicts feed the 98% target."
      actions={
        <Button
          variant="outline"
          size="sm"
          aria-disabled={audit.isFetching || undefined}
          onClick={() => {
            if (!audit.isFetching) void audit.refetch()
          }}
        >
          {audit.isFetching && audit.data ? "Loading…" : "Load another sample"}
        </Button>
      }
    >
      {audit.isPending ? (
        <div aria-hidden="true" className="space-y-3">
          <PlaceholderBar width="40%" />
          <PlaceholderBar width="85%" />
          <PlaceholderBar width="70%" />
        </div>
      ) : audit.isError ? (
        <CalmError size="inline" title="We couldn't load an audit sample" error={audit.error} onRetry={() => void audit.refetch()} />
      ) : leads.length === 0 ? (
        <EmptyState
          size="inline"
          title="Nothing to audit yet"
          description="Leads with finished research from the last 30 days appear here."
        />
      ) : (
        <div className={cn("transition-opacity", audit.isFetching && "opacity-60")} aria-busy={audit.isFetching}>
          <p className="border-b-2 border-ink pb-3 text-ui">
            {reviewed === totalFacts && totalFacts > 0 ? (
              <StatusWord tone="good">All {plural(totalFacts, "fact")} in this sample reviewed</StatusWord>
            ) : (
              <>
                {reviewed} of {plural(totalFacts, "fact")} reviewed in {plural(leads.length, "lead")}.
              </>
            )}
          </p>
          {leads.map((lead, index) => (
            <AuditLeadCard key={lead.lead_id} lead={lead} defaultOpen={index === 0} />
          ))}
        </div>
      )}
    </Section>
  )
}
