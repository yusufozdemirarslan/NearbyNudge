import { PageHeader } from "@/components/PageHeader"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { OptOutForm } from "./OptOutForm"
import { CodeBlock, List, Prose, ProseSection, TextLink } from "./prose"

const ROBOTS_TXT = "User-agent: NearbyNudgeBot\nDisallow: /"

/** /bot: what NearbyNudgeBot reads, how it behaves and how site owners opt out. */
export function BotPage() {
  useDocumentTitle("NearbyNudgeBot")
  const userAgent = `NearbyNudgeBot/2.0 (+${window.location.origin}/bot)`
  return (
    <>
      <PageHeader
        title="NearbyNudgeBot"
        description="The reader NearbyNudge uses to visit business websites: what it reads, how it behaves and how to keep it away from your site."
      />
      <Prose>
        <ProseSection id="what-it-is" title="What it is">
          <p>
            NearbyNudge helps small business-to-business firms find nearby
            businesses that may need their services. When someone starts a
            campaign, NearbyNudgeBot visits the public website of each business
            on the list to learn what it does, so the email they review can
            mention something real and specific.
          </p>
          <p>It names itself in every request with this user agent:</p>
          <CodeBlock code={userAgent} label="user agent" />
          <p>
            NearbyNudge never sends email itself. People who use it review each
            draft and send it from their own email account.
          </p>
        </ProseSection>

        <ProseSection id="what-it-reads" title="What it reads">
          <List>
            <li>
              Only a business&rsquo;s own public website. It doesn&rsquo;t read
              social networks, review sites or map services.
            </li>
            <li>
              At most 5 pages per business, such as the home, About, Services
              and Contact pages.
            </li>
            <li>At most one page a second from any site.</li>
            <li>
              It obeys robots.txt and reads it again every day. If your
              robots.txt can&rsquo;t be read, it stays out.
            </li>
            <li>
              It never signs in, fills in forms or gets past bot checks, and it
              doesn&rsquo;t pretend to be a person.
            </li>
            <li>
              It downloads web pages only, not images, video or other files.
            </li>
            <li>
              It keeps a copy of each page it read for 30 days, so every fact in
              a draft can be checked against its source, then deletes it.
            </li>
          </List>
        </ProseSection>

        <ProseSection id="what-happens" title="What happens to the text">
          <p>
            Email addresses and phone numbers are masked before
            NearbyNudge&rsquo;s AI reads the page text. The AI notes a few
            facts, each with a short quote and a link to its page, and drafts a
            short email for a person to review. If a contact form says it
            doesn&rsquo;t accept sales offers, or a page asks visitors not to
            collect its email addresses, NearbyNudge doesn&rsquo;t suggest that
            form or address.
          </p>
          <p>
            The <TextLink to="/data-sources">Data sources</TextLink> and{" "}
            <TextLink to="/privacy">Privacy</TextLink> pages say more about
            where NearbyNudge&rsquo;s information comes from and what its AI
            receives.
          </p>
        </ProseSection>

        <ProseSection
          id="opt-out"
          title="Keep NearbyNudgeBot away from your site"
        >
          <div className="flex flex-col gap-3">
            <h3 className="text-lead font-bold">Add two lines to robots.txt</h3>
            <p>
              Add these lines to the robots.txt file at the top of your site.
              NearbyNudgeBot checks it every day.
            </p>
            <CodeBlock code={ROBOTS_TXT} label="robots.txt lines" />
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-lead font-bold">Or ask us here</h3>
            <p>
              We stop reading your site within 2 business days, usually right
              away. We use your email only to confirm the request or ask about
              it.
            </p>
            <OptOutForm />
          </div>
        </ProseSection>
      </Prose>
    </>
  )
}
