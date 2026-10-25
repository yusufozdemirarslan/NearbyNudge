import * as React from "react"
import { CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmailAddress } from "@/components/EmailAddress"
import { Mark } from "@/components/Mark"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { SourceTag } from "@/components/SourceTag"
import type { Contact, Fact, Lead, SiteCheck } from "@/lib/api/types"
import { claimProblems, firstCitingSentence, usedFacts } from "@/lib/email"
import { displayDomain, formatDate, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useDesk } from "./desk-state"

export interface EvidencePanelProps {
  lead: Lead
  numbers: Map<string, number>
  /** ≥ 1280 px: line facts up beside the sentences that cite them. */
  aligned: boolean
  onCopyAddress: () => void
  onWrongFact: ((fact: Fact, note?: string) => void) | null
  className?: string
}

/** Contact, the facts the email uses, the site check and a one-line summary. */
export function EvidencePanel({ lead, numbers, aligned, onCopyAddress, onWrongFact, className }: EvidencePanelProps) {
  const [showAll, setShowAll] = React.useState(false)
  const used = usedFacts(lead.email, lead.facts)
  const usedIds = new Set(used.map((fact) => fact.id))
  const others = lead.facts.filter((fact) => !usedIds.has(fact.id))
  const problems = claimProblems(lead.email)

  React.useEffect(() => setShowAll(false), [lead.id])

  return (
    <aside aria-labelledby="evidence-heading" className={cn("space-y-7", className)} data-slot="evidence">
      <h2 id="evidence-heading" className="sr-only">
        Evidence
      </h2>
      <section aria-labelledby="contact-heading" className="space-y-2">
        <h3 id="contact-heading" className="text-lead font-extrabold stretch-condensed">
          Contact
        </h3>
        {lead.status === "failed" && !lead.contact ? (
          <p className="aside">Not found before research stopped.</p>
        ) : (
          <ContactBlock contact={lead.contact} phone={lead.phone} onCopyAddress={onCopyAddress} />
        )}
      </section>

      <section aria-labelledby="facts-heading" className="space-y-2">
        <h3 id="facts-heading" className="flex items-baseline gap-2">
          <span className="text-lead font-extrabold stretch-condensed">Facts used</span>
          {lead.facts.length > 0 && (
            <span className="aside">
              {used.length} of {lead.facts.length}
            </span>
          )}
        </h3>
        {lead.facts.length === 0 ? (
          <p className="aside">
            {lead.email
              ? "This draft uses no site facts."
              : lead.status === "failed"
                ? "None saved before research stopped."
                : "Facts appear once the site has been read."}
          </p>
        ) : (
          <AlignedFacts lead={lead} facts={used} numbers={numbers} aligned={aligned} onWrongFact={onWrongFact} />
        )}
        {others.length > 0 && (
          <div className="space-y-2">
            <Button
              variant="link"
              size="xs"
              className="h-auto px-0"
              aria-expanded={showAll}
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show fewer facts" : `Show all ${lead.facts.length}`}
            </Button>
            {showAll && (
              <ul className="space-y-2">
                {others.map((fact) => (
                  <FactItem key={fact.id} fact={fact} number={null} onWrongFact={null} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="sitecheck-heading" className="space-y-2">
        <h3 id="sitecheck-heading" className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lead font-extrabold stretch-condensed">Site check</span>
          {lead.site_check && (
            <span className="aside">
              {displayDomain(lead.site_check.url)}, {formatDate(lead.site_check.checked_at)}
            </span>
          )}
        </h3>
        {lead.site_check ? (
          <SiteCheckGrid check={lead.site_check} />
        ) : (
          <p className="aside">
            {!lead.website
              ? "No website to check."
              : lead.status === "failed"
                ? "The site couldn't be checked."
                : "The site check appears once the site has been read."}
          </p>
        )}
      </section>

      {lead.email && (
        <p
          className={cn(
            "flex items-center gap-2 border-t-2 border-ink pt-3 text-ui font-bold",
            problems.length > 0 && "text-edge"
          )}
          data-slot="evidence-summary"
        >
          <Mark name={problems.length === 0 ? "check" : "asterisk"} />
          {problems.length === 0
            ? "Every claim has a source"
            : `${plural(problems.length, "claim")} ${problems.length === 1 ? "needs" : "need"} checking`}
        </p>
      )}
    </aside>
  )
}

function ContactBlock({ contact, phone, onCopyAddress }: { contact: Contact | null; phone: string | null; onCopyAddress: () => void }) {
  if (!contact) {
    return (
      <div className="space-y-1.5" aria-hidden="true">
        <PlaceholderBar width="80%" />
        <PlaceholderBar width="45%" />
      </div>
    )
  }
  const source =
    contact.source_kind === "listing" ? (
      <SourceTag kind="listing" label={contact.source_label ?? "Business listing"} />
    ) : contact.source_kind && contact.source_label ? (
      <SourceTag
        kind={contact.source_kind}
        label={contact.source_label}
        date={contact.seen_at}
        href={contact.source_url}
      />
    ) : null
  return (
    <div className="space-y-2">
      {contact.kind === "email" && contact.email ? (
        <div className="flex items-center gap-1">
          <p className="min-w-0 text-ui font-bold" data-slot="contact-email">
            <EmailAddress email={contact.email} />
          </p>
          <Button variant="ghost" size="icon-xs" onClick={onCopyAddress} aria-label={`Copy ${contact.email}`}>
            <CopyIcon aria-hidden="true" />
          </Button>
        </div>
      ) : contact.kind === "form" && contact.form_url ? (
        <a
          href={contact.form_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ui font-bold underline underline-offset-3 hover:text-edge"
        >
          Contact form
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <div className="space-y-1">
          <p className="text-ui font-bold">No published contact</p>
          <p className="text-ui">
            We didn't find an email address or a contact form we may use.
            {phone ? ` You could call ${phone}, or skip this business.` : " You can skip this business."}
          </p>
        </div>
      )}
      {source && <div>{source}</div>}
      {contact.note && <p className="aside">{contact.note}</p>}
    </div>
  )
}

/** Facts in citation order; at ≥ 1280 px each sits level with its first citing sentence. */
function AlignedFacts({
  lead,
  facts,
  numbers,
  aligned,
  onWrongFact,
}: {
  lead: Lead
  facts: Fact[]
  numbers: Map<string, number>
  aligned: boolean
  onWrongFact: ((fact: Fact, note?: string) => void) | null
}) {
  const desk = useDesk()
  const boxRef = React.useRef<HTMLUListElement>(null)
  const itemEls = React.useRef(new Map<string, HTMLElement>())
  const [layout, setLayout] = React.useState<{ tops: Record<string, number>; height: number } | null>(null)
  const firstSentence = React.useMemo(() => firstCitingSentence(lead.email), [lead.email])
  const ids = facts.map((fact) => fact.id).join("|")

  React.useLayoutEffect(() => {
    if (!aligned) {
      setLayout(null)
      return
    }
    const compute = () => {
      const box = boxRef.current
      if (!box) return
      const boxTop = box.getBoundingClientRect().top
      const tops: Record<string, number> = {}
      let cursor = 0
      for (const fact of facts) {
        const el = itemEls.current.get(fact.id)
        if (!el) continue
        const sentenceId = firstSentence.get(fact.id)
        const sentenceEl = sentenceId ? desk.sentenceEls.current.get(sentenceId) : undefined
        const desired = sentenceEl ? Math.round(sentenceEl.getBoundingClientRect().top - boxTop - 4) : cursor
        const top = Math.max(desired, cursor)
        tops[fact.id] = top
        cursor = top + el.offsetHeight + 10
      }
      setLayout((current) => {
        if (current && current.height === cursor && Object.keys(tops).every((k) => current.tops[k] === tops[k])) return current
        return { tops, height: cursor }
      })
    }
    compute()
    const observer = new ResizeObserver(() => compute())
    const emailText = document.querySelector('[data-slot="email-panel"]')
    if (emailText) observer.observe(emailText)
    for (const el of itemEls.current.values()) observer.observe(el)
    window.addEventListener("resize", compute)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", compute)
    }
    // ids and the email version decide what to measure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aligned, ids, lead.email?.version_id, firstSentence, desk.layoutTick])

  return (
    <ul
      ref={boxRef}
      className={cn("relative", !layout && "space-y-2")}
      style={layout ? { height: layout.height } : undefined}
      data-aligned={layout ? "true" : "false"}
    >
      {facts.map((fact) => (
        <FactItem
          key={fact.id}
          ref={(el) => {
            if (el) itemEls.current.set(fact.id, el)
            else itemEls.current.delete(fact.id)
          }}
          fact={fact}
          number={numbers.get(fact.id) ?? null}
          onWrongFact={onWrongFact}
          style={layout ? { position: "absolute", top: layout.tops[fact.id] ?? 0, left: 0, right: 0 } : undefined}
        />
      ))}
    </ul>
  )
}

const FactItem = React.forwardRef<
  HTMLLIElement,
  {
    fact: Fact
    number: number | null
    onWrongFact: ((fact: Fact, note?: string) => void) | null
    style?: React.CSSProperties
  }
>(function FactItem({ fact, number, onWrongFact, style }, ref) {
  const desk = useDesk()
  const [confirming, setConfirming] = React.useState(false)
  const [note, setNote] = React.useState("")
  const active = desk.activeFactId === fact.id
  return (
    <li
      ref={ref}
      id={`fact-${fact.id}`}
      tabIndex={-1}
      data-fact-id={fact.id}
      style={style}
      onMouseEnter={() => desk.setActiveFactId(fact.id)}
      onMouseLeave={() => desk.setActiveFactId(null)}
      onFocus={() => desk.setActiveFactId(fact.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) desk.setActiveFactId(null)
      }}
      className={cn(
        "-mx-2 px-2 py-2 transition-[background-color,top] duration-(--dur-fast)",
        active && "bg-tint",
        fact.flagged_wrong && "text-ink-soft"
      )}
    >
      <div className="flex gap-2">
        {number !== null && (
          <span
            className={cn(
              "inline-flex h-5 min-w-5 shrink-0 items-center justify-center px-0.5 text-ui leading-none font-extrabold stretch-condensed tabular-nums",
              active && "bg-ink text-paper"
            )}
          >
            <span aria-hidden="true">{number}</span>
          </span>
        )}
        <p className={cn("min-w-0 text-ui", fact.flagged_wrong && "line-through decoration-1")}>
          {number !== null && <span className="sr-only">Fact {number}: </span>}
          {fact.text}
          {fact.flagged_wrong && <span className="sr-only"> (marked wrong)</span>}
        </p>
      </div>
      <div className={cn("mt-1", number !== null && "pl-7")}>
        {fact.source_kind === "listing" ? (
          <SourceTag kind="listing" label={fact.source_label} />
        ) : (
          <SourceTag
            kind={fact.source_kind}
            label={fact.source_label}
            date={fact.seen_at}
            href={fact.fragment_url ?? fact.url}
            quote={fact.quote}
            quoteFound={fact.quote_found}
          />
        )}
      </div>
      <div className={cn("mt-1 flex min-h-6 items-center gap-2", number !== null && "pl-7")}>
        {fact.flagged_wrong ? (
          <span className="inline-flex items-center gap-1.5 text-meta">
            <Mark name="cross" />
            Marked wrong
          </span>
        ) : fact.state === "supported" ? (
          <span className="inline-flex items-center gap-1.5 text-meta">
            <Mark name="check" />
            Supported
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-meta font-bold text-edge">
            <Mark name="asterisk" />
            Check
          </span>
        )}
        {onWrongFact && !fact.flagged_wrong && !confirming && (
          <Button variant="ghost" size="xs" className="-mr-1.5 ml-auto h-6 px-1.5 font-semibold" onClick={() => setConfirming(true)}>
            Wrong fact
          </Button>
        )}
      </div>
      {confirming && onWrongFact && (
        <form
          className={cn("mt-2.5 space-y-2 border-t border-hairline pt-2.5", number !== null && "ml-7")}
          onSubmit={(event) => {
            event.preventDefault()
            onWrongFact(fact, note.trim() || undefined)
            setConfirming(false)
            setNote("")
          }}
        >
          <p className="aside">We'll remove it, rewrite the email without it and count it in the weekly audit.</p>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What's wrong? (optional)"
            aria-label={`What's wrong with fact ${number ?? ""}? Optional`}
            className="h-9"
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" size="xs">
              Remove and rewrite
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  )
})

function CheckValue({ ok, yes, no, unknown = "Unknown" }: { ok: boolean | null; yes: string; no: string; unknown?: string }) {
  if (ok === null) return <span className="italic">{unknown}</span>
  return ok ? <span>{yes}</span> : <span className="font-bold">{no}</span>
}

/** The site check as a key: label, dot leader, value. The gaps it found are set in bold. */
export function SiteCheckGrid({ check }: { check: SiteCheck }) {
  const year = new Date().getFullYear()
  const dated = check.copyright_year !== null && check.copyright_year < year - 2
  const slow = check.load_seconds !== null && check.load_seconds > 3
  const rows: [string, React.ReactNode][] = [
    ["Secure", <CheckValue key="secure" ok={check.secure} yes="Yes" no="No" />],
    ["Mobile", <CheckValue key="mobile" ok={check.mobile_ready} yes="Ready" no="Not ready" />],
    [
      "Load time",
      check.load_seconds === null ? (
        <CheckValue key="load" ok={null} yes="" no="" />
      ) : (
        <span key="load" className={cn("tabular-nums", slow && "font-bold")}>
          {check.load_seconds.toFixed(1)} s{slow ? ", slow" : ""}
        </span>
      ),
    ],
    [
      "Copyright",
      check.copyright_year === null ? (
        <CheckValue key="year" ok={null} yes="" no="" unknown="Not shown" />
      ) : (
        <span key="year" className={cn("tabular-nums", dated && "font-bold")}>
          {check.copyright_year}
          {dated ? ", dated" : ""}
        </span>
      ),
    ],
    ["Booking", <CheckValue key="booking" ok={check.online_booking} yes="Online" no="None online" />],
    ["Hours", <CheckValue key="hours" ok={check.hours} yes="Listed" no="Not listed" />],
    ["Prices", <CheckValue key="prices" ok={check.prices} yes="Listed" no="Not listed" />],
    [
      "Social",
      <span key="social" className={cn(!check.social.length && "italic")}>
        {check.social.length ? check.social.join(", ") : "None found"}
      </span>,
    ],
  ]
  return (
    <dl className="space-y-1 text-ui" data-slot="site-check">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="shrink-0">{label}</dt>
          <span aria-hidden="true" className="leader" />
          <dd className="min-w-0 text-right">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
