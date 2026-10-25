import { PageHeader } from "@/components/PageHeader"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { AI_PROVIDER } from "./ai-provider"
import { List, Prose, ProseSection, TextLink, Updated } from "./prose"

const RETENTION: { what: string; howLong: string }[] = [
  {
    what: "Your sender profile and preferences",
    howLong: "Until you change them or delete all data",
  },
  {
    what: "Campaigns, leads, facts and emails",
    howLong: "Until you delete them, or 24 months after your last activity",
  },
  {
    what: "Your Do not contact list",
    howLong:
      "Until you delete all data, so those businesses are never drafted again",
  },
  { what: "Copies of the web pages NearbyNudgeBot read", howLong: "30 days" },
]

/** /privacy: what NearbyNudge stores, what the AI receives, and deleting your data. */
export function PrivacyPage() {
  useDocumentTitle("Privacy")
  return (
    <>
      <PageHeader
        title="Privacy"
        description="What NearbyNudge stores and for how long, what its AI receives, and how to delete your data."
      >
        <Updated date="October 25, 2026" />
      </PageHeader>
      <Prose>
        <ProseSection
          id="what-we-store"
          title="What we store, and for how long"
        >
          <table className="w-full border-collapse text-left text-ui">
            <caption className="sr-only">
              What NearbyNudge stores and how long it keeps it
            </caption>
            <thead>
              <tr className="border-b">
                <th
                  scope="col"
                  className="py-2 pr-4 font-medium text-ink-secondary"
                >
                  What
                </th>
                <th scope="col" className="py-2 font-medium text-ink-secondary">
                  How long we keep it
                </th>
              </tr>
            </thead>
            <tbody>
              {RETENTION.map((row) => (
                <tr key={row.what} className="border-b align-top last:border-0">
                  <th
                    scope="row"
                    className="py-2.5 pr-4 font-semibold text-foreground"
                  >
                    {row.what}
                  </th>
                  <td className="py-2.5 text-foreground">{row.howLong}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <List>
            <li>
              NearbyNudge has no sign-in. Everyone who can open this copy of
              the app sees the same campaigns, lists and settings.
            </li>
            <li>
              You can export your Do not contact list, and each campaign, as a
              spreadsheet at any time.
            </li>
            <li>
              Cookies only protect your forms and remember whether the sidebar
              is open. There are no analytics, advertising or tracking cookies,
              and the app loads nothing from other companies&rsquo; servers.
            </li>
          </List>
        </ProseSection>

        <ProseSection id="what-the-ai-receives" title="What the AI receives">
          <p>
            NearbyNudge uses one AI, {AI_PROVIDER.product} by{" "}
            {AI_PROVIDER.vendor}, to plan campaigns, research businesses, and
            write and check drafts. To do that it receives:
          </p>
          <List>
            <li>
              the offer you describe: what you sell, your proof point, your ask
              and your tone;
            </li>
            <li>your name and company;</li>
            <li>
              listing details about each business, such as its name, category,
              town and website;
            </li>
            <li>
              public text from each business&rsquo;s website, with email
              addresses and phone numbers masked.
            </li>
          </List>
          <p>
            For a business without a website, the AI may run one web search with
            the business&rsquo;s name and town to check that it is still open.
          </p>
          <p>It never receives:</p>
          <List>
            <li>
              prospects&rsquo; contact details, such as their email addresses or
              phone numbers;
            </li>
            <li>your postal address;</li>
            <li>IP addresses.</li>
          </List>
        </ProseSection>

        <ProseSection
          id="ai-provider"
          title={`How ${AI_PROVIDER.vendor} handles it`}
        >
          <p>
            {AI_PROVIDER.vendor} processes this information to provide the AI
            service to NearbyNudge. {AI_PROVIDER.training}
          </p>
        </ProseSection>

        <ProseSection id="delete" title="Delete your data">
          <p>
            You can delete everything at any time with{" "}
            <TextLink to="/settings" hash="delete-data">
              Delete all data in Settings
            </TextLink>
            . It removes your sender profile, preferences, campaigns, leads,
            facts, emails and Do not contact list right away, and it
            can&rsquo;t be undone.
          </p>
        </ProseSection>
      </Prose>
    </>
  )
}
