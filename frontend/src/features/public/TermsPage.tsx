import { PageHeader } from "@/components/PageHeader"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { List, NoWrap, Prose, ProseSection, TextLink, Updated } from "./prose"

/** /terms: the plain-language pilot terms (PRD AC2, §9). */
export function TermsPage() {
  useDocumentTitle("Terms of use")
  return (
    <>
      <PageHeader
        title="Terms of use"
        description="The rules for using NearbyNudge during the pilot, in plain words. By using NearbyNudge you agree to them."
      >
        <Updated date="October 25, 2026" />
      </PageHeader>
      <Prose>
        <ProseSection
          id="who"
          title="Business to business, in the United States"
        >
          <p>
            NearbyNudge is for business-to-business outreach in the United
            States. Use it to contact US businesses about products or services
            for their business.
          </p>
          <List>
            <li>Don&rsquo;t use it to contact consumers.</li>
            <li>
              Don&rsquo;t use it to contact businesses outside the United
              States.
            </li>
          </List>
        </ProseSection>

        <ProseSection id="sender" title="You are the sender">
          <p>
            NearbyNudge doesn&rsquo;t send email. You copy a draft or open it in
            your own email app, and you send it from your own account. That
            makes you the sender, and you are responsible for following the{" "}
            <NoWrap>CAN-SPAM Act</NoWrap>, which covers business-to-business
            email too. In particular:
          </p>
          <List>
            <li>
              <strong className="font-semibold">
                Use an honest subject line
              </strong>{" "}
              that matches what the email is about.
            </li>
            <li>
              <strong className="font-semibold">
                Send from accurate sender details:
              </strong>{" "}
              your real name, company and email address.
            </li>
            <li>
              <strong className="font-semibold">
                Include a valid postal address.
              </strong>{" "}
              NearbyNudge adds the one in your sender profile to every footer.
            </li>
            <li>
              <strong className="font-semibold">
                Give a working way to opt out, and honor it within 10 business
                days.
              </strong>{" "}
              Every footer ends with &ldquo;Not interested? Reply &lsquo;no
              thanks&rsquo; and I won&rsquo;t email again.&rdquo; When someone
              replies that way, log it in NearbyNudge so the business goes on
              your Do not contact list.
            </li>
            <li>
              <strong className="font-semibold">
                Identify the email as an ad.
              </strong>{" "}
              The footer says the email is a business offer from your company.
            </li>
          </List>
          <p>
            The FTC can fine a sender up to $53,088 for each email that breaks
            these rules. Its guide &ldquo;
            <NoWrap>CAN-SPAM Act</NoWrap>: A Compliance Guide for
            Business&rdquo;, on ftc.gov, explains them in more detail.
          </p>
        </ProseSection>

        <ProseSection id="true-claims" title="Say only what's true">
          <p>
            Don&rsquo;t make false or misleading claims about your company, your
            results or the business you&rsquo;re writing to. Proof points such
            as &ldquo;grew bookings 30%&rdquo; must be real and yours.
          </p>
        </ProseSection>

        <ProseSection id="review" title="Review every draft">
          <p>
            Every email is written by AI. NearbyNudge links each fact to the
            page it came from and has the AI check every claim, but AI can still
            get things wrong. Read each draft and its sources before you approve
            it, and edit or skip anything that is wrong, out of date or
            doesn&rsquo;t sound like you. You decide what is sent.
          </p>
        </ProseSection>

        <ProseSection id="pilot" title="The pilot">
          <List>
            <li>
              It&rsquo;s free during the pilot. Usage limits are shown in the
              app.
            </li>
            <li>Features may change as we learn from the pilot.</li>
          </List>
        </ProseSection>

        <ProseSection id="data" title="Your data">
          <p>
            The <TextLink to="/privacy">Privacy</TextLink> page explains what
            NearbyNudge stores, what its AI receives and how to delete your
            data.
          </p>
        </ProseSection>
      </Prose>
    </>
  )
}
