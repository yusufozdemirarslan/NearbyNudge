import type * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { CalmError } from "@/components/CalmError"
import { PageContainer } from "@/components/PageContainer"
import { PageHeader } from "@/components/PageHeader"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { RecentCallsSection, RecentErrorsSection } from "./ActivitySections"
import { AuditSection } from "./AuditSection"
import { OptOutsSection } from "./OptOutsSection"
import { AiStatusSection, BalanceSection, QueueQualitySection, SpendSection } from "./OverviewSections"
import { adminOverviewQuery } from "./queries"

const SECTIONS = [
  { id: "ai", label: "AI status" },
  { id: "spend", label: "Spend" },
  { id: "balance", label: "Balance" },
  { id: "quality", label: "Queue and quality" },
  { id: "audit", label: "Audit sample" },
  { id: "errors", label: "Errors" },
  { id: "calls", label: "AI calls" },
  { id: "optouts", label: "Opt-outs" },
]

/** Section links. Moves focus to the section's heading so keyboard users land there too. */
function JumpNav() {
  const jump = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const section = document.getElementById(id)
    if (!section) return
    event.preventDefault()
    section.scrollIntoView({ block: "start" })
    section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true })
  }
  return (
    <nav aria-label="Admin sections" className="-mt-4 mb-10">
      <ul className="flex flex-wrap gap-x-6 gap-y-1">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              onClick={(event) => jump(event, section.id)}
              className="inline-flex min-h-10 items-center text-ui font-bold decoration-2 underline-offset-6 hover:underline"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function OverviewLoading() {
  return (
    <div aria-hidden="true" className="space-y-12">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4 border-t-2 border-ink pt-5">
          <PlaceholderBar width="10ch" className="block" />
          <PlaceholderBar width="60%" className="block" />
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((j) => (
              <PlaceholderBar key={j} width="100%" className="block" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Admin console (AC3): AI status and spend, balance forecast, quality, audits, errors, AI calls, opt-outs. */
export function AdminPage() {
  const overview = useQuery(adminOverviewQuery())
  useDocumentTitle("Admin console")

  return (
    <PageContainer>
      <PageHeader
        title="Admin console"
        description="The app's health in one place: the AI's status and spend, the balance forecast, quality checks and site-owner opt-outs."
      />
      <JumpNav />
      <div className="space-y-12">
        {overview.isPending && <OverviewLoading />}
        {overview.isError && !overview.data && (
          <CalmError
            title="We couldn't load the AI status and spend"
            error={overview.error}
            onRetry={() => void overview.refetch()}
          />
        )}
        {overview.data && (
          <>
            <AiStatusSection overview={overview.data} />
            <SpendSection overview={overview.data} />
            <BalanceSection overview={overview.data} />
            <QueueQualitySection overview={overview.data} />
          </>
        )}
        <AuditSection />
        <RecentErrorsSection />
        <RecentCallsSection />
        <OptOutsSection />
      </div>
    </PageContainer>
  )
}
