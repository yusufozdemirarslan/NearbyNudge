import { useNavigate } from "@tanstack/react-router"
import { CalmError } from "@/components/CalmError"
import { PageHeader } from "@/components/PageHeader"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { useAccount } from "@/hooks/use-account"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { SenderProfileForm } from "@/features/settings/SenderProfileForm"

/**
 * First-run sender profile (AC1, WR2): name, title, company, postal address,
 * default tone and time zone, with a live preview of the locked footer.
 * It is the only set-up step (there is no sign-in). Saving marks the
 * workspace onboarded and continues to New campaign.
 */
export function OnboardingPage() {
  useDocumentTitle("Set up your sender profile")
  const navigate = useNavigate()
  const account = useAccount()

  return (
    <>
      <PageHeader
        title="Set up your sender profile"
        description="These details go at the end of every email you send. US law (the CAN-SPAM Act) requires accurate sender details and a postal address. You can change them later in Settings."
      />

      <div className="rounded-xl border bg-card p-5 sm:p-6">
        {account.isError ? (
          <CalmError
            size="inline"
            title="We couldn't load your sender profile"
            error={account.error}
            onRetry={() => void account.refetch()}
          />
        ) : account.isPending ? (
          <div className="flex flex-col gap-5" aria-busy="true">
            <p className="text-ui text-ink-secondary">Loading…</p>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex flex-col gap-2">
                <PlaceholderBar width={96} />
                <PlaceholderBar height={36} width="100%" />
              </div>
            ))}
          </div>
        ) : (
          <SenderProfileForm
            profile={account.data.profile}
            submitLabel="Save and set up a campaign"
            headingLevel={2}
            autoFocus
            onSaved={() => navigate({ to: "/campaigns/new" })}
          />
        )}
      </div>
    </>
  )
}
