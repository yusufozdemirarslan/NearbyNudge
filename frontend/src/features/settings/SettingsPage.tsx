import * as React from "react"
import { useRouterState } from "@tanstack/react-router"
import { CalmError } from "@/components/CalmError"
import { PageContainer } from "@/components/PageContainer"
import { PageHeader } from "@/components/PageHeader"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { useAccount } from "@/hooks/use-account"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { DeleteDataSection } from "./DeleteDataSection"
import { Section } from "./form-kit"
import { PreferencesSection } from "./PreferencesSection"
import { SenderProfileForm } from "./SenderProfileForm"
import { UsageSection } from "./UsageSection"

/** Section anchors. Other pages link here, e.g. <Link to="/settings" hash="sender-profile">. */
export const SETTINGS_SECTIONS = [
  { id: "sender-profile", label: "Sender profile" },
  { id: "preferences", label: "Preferences" },
  { id: "usage", label: "Usage" },
  { id: "delete-data", label: "Delete all data" },
] as const

/**
 * Settings (AC1): sender profile with the footer preview, preferences,
 * usage and delete-all-data, on one page with a jump list. A #hash in the
 * address scrolls to and focuses that section.
 */
export function SettingsPage() {
  useDocumentTitle("Settings")
  const account = useAccount()
  const hash = useRouterState({ select: (state) => state.location.hash })
  const ready = account.isSuccess

  // Run after the shell's own "focus the page heading" step on navigation.
  React.useEffect(() => {
    if (!hash || !ready) return
    const timer = window.setTimeout(() => {
      const section = document.getElementById(hash)
      if (!section) return
      section.scrollIntoView({ block: "start" })
      section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [hash, ready])

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Settings"
        description="Your sender details, how NearbyNudge behaves, this month's usage, and your data."
      >
        <nav aria-label="Settings sections">
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {SETTINGS_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={hash === section.id ? "location" : undefined}
                  className="inline-flex min-h-10 items-center text-ui font-bold decoration-2 underline-offset-6 hover:underline aria-[current=location]:underline aria-[current=location]:decoration-edge"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </PageHeader>

      {account.isError ? (
        <CalmError title="We couldn't load your settings" error={account.error} onRetry={() => void account.refetch()} />
      ) : !ready ? (
        <div className="flex flex-col gap-12" aria-busy="true">
          <p className="sr-only">Loading your settings…</p>
          {[0, 1, 2].map((panel) => (
            <div key={panel} className="flex flex-col gap-4 border-t-2 border-ink pt-5">
              <PlaceholderBar width={160} className="block" />
              <PlaceholderBar width="70%" className="block" />
              <PlaceholderBar width="100%" className="block" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-12">
          <Section
            id="sender-profile"
            title="Sender profile"
            description="NearbyNudge builds the footer of every email from these details, so a change shows up in all your drafts at once."
          >
            <SenderProfileForm
              profile={account.data.profile}
              savedFooter={account.data.footer_preview}
              submitLabel="Save sender profile"
              headingLevel={3}
            />
          </Section>
          <PreferencesSection preferences={account.data.preferences} />
          <UsageSection account={account.data} />
          <DeleteDataSection />
        </div>
      )}
    </PageContainer>
  )
}
