import type { ReactNode } from "react"
import { PageHeader } from "@/components/PageHeader"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { cn } from "@/lib/utils"
import { AI_PROVIDER } from "./ai-provider"
import { Prose, ProseSection, TextLink } from "./prose"

interface Credit {
  name: string
  use: string
  license: string
}

const FRONTEND: Credit[] = [
  { name: "React", use: "The interface you use", license: "MIT" },
  { name: "Vite", use: "Builds the dashboard", license: "MIT" },
  { name: "Tailwind CSS", use: "Styling", license: "MIT" },
  { name: "shadcn/ui", use: "Interface components", license: "MIT" },
  {
    name: "Base UI",
    use: "Accessible building blocks for menus, dialogs and forms",
    license: "MIT",
  },
  {
    name: "TanStack",
    use: "Page routing, data loading and tables",
    license: "MIT",
  },
  { name: "Recharts", use: "Charts on the Numbers page", license: "MIT" },
  { name: "Lucide", use: "Icons", license: "ISC" },
  {
    name: "Archivo",
    use: "The typeface, from Omnibus-Type, in its normal and condensed widths",
    license: "SIL Open Font License 1.1 (OFL)",
  },
]

const BACKEND: Credit[] = [
  { name: "FastAPI", use: "The web server", license: "MIT" },
  {
    name: "SQLAlchemy",
    use: "Stores campaigns, leads and settings",
    license: "MIT",
  },
  {
    name: "DuckDB",
    use: "Searches the business listings by category and distance",
    license: "MIT",
  },
  {
    name: "trafilatura",
    use: "Turns web pages into clean text",
    license: "Apache 2.0",
  },
  {
    name: "extruct",
    use: "Reads business details that sites embed for search engines",
    license: "BSD 3-Clause",
  },
  {
    name: "httpx",
    use: "Fetches web pages for NearbyNudgeBot",
    license: "BSD 3-Clause",
  },
]

function CreditTable({
  caption,
  credits,
}: {
  caption: string
  credits: Credit[]
}) {
  return (
    <table className="w-full table-fixed border-collapse text-left text-ui">
      <caption className="mb-2 text-left text-lead font-extrabold stretch-condensed">
        {caption}
      </caption>
      <thead>
        <tr className="border-b-2 border-ink">
          <th scope="col" className="w-[31%] py-2 pr-4 font-extrabold stretch-condensed">
            Project
          </th>
          <th scope="col" className="py-2 pr-4 font-extrabold stretch-condensed">
            What it does here
          </th>
          <th scope="col" className="w-[27%] py-2 font-extrabold stretch-condensed sm:w-[24%]">
            License
          </th>
        </tr>
      </thead>
      <tbody>
        {credits.map((credit) => (
          <tr key={credit.name} className="border-b border-hairline align-top">
            <th scope="row" className="py-2.5 pr-4 font-semibold">
              {credit.name}
            </th>
            <td className="py-2.5 pr-4">{credit.use}</td>
            <td
              className={cn(
                "py-2.5",
                credit.license.length <= 14 && "whitespace-nowrap"
              )}
            >
              {credit.license}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Each source as a short key of facts between two rules: who publishes it and under what license. */
function SourceFacts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-y-2 border-ink py-2.5 text-ui sm:grid-cols-[9rem_minmax(0,1fr)]">
      {rows.map(([term, detail]) => (
        <div key={term} className="contents">
          <dt className="pt-1.5 font-bold sm:pt-1">{term}</dt>
          <dd className="pb-1.5 sm:py-1">{detail}</dd>
        </div>
      ))}
    </dl>
  )
}

/** /data-sources: where NearbyNudge's information comes from, and credits. */
export function DataSourcesPage() {
  useDocumentTitle("Data sources")
  return (
    <>
      <PageHeader
        title="Data sources"
        description="Where NearbyNudge's information comes from, and the open-source software it is built with. Thank you to everyone who makes these available."
      />
      <Prose>
        <ProseSection
          id="listings"
          title="Business listings: Overture Maps Places"
        >
          <p>
            NearbyNudge finds businesses in Overture Maps Places, an open
            dataset of places that the Overture Maps Foundation publishes every
            month. We download the files and search them on our own server, so
            no other company is asked about your searches.
          </p>
          <SourceFacts
            rows={[
              ["Published by", "Overture Maps Foundation"],
              ["License", "CDLA Permissive 2.0 and Apache 2.0"],
              [
                "Contributors",
                "The places data includes contributions from Meta, Microsoft, Foursquare and others.",
              ],
              [
                "In NearbyNudge",
                "Facts that come from a listing are labeled with the dataset and its release month.",
              ],
            ]}
          />
        </ProseSection>

        <ProseSection
          id="locations"
          title="Locations: U.S. Census Bureau Gazetteer files"
        >
          <p>
            The cities and ZIP codes you type are matched with the U.S. Census
            Bureau&rsquo;s Gazetteer files, which give the center point that
            distances are measured from. No mapping or address-lookup service is
            used.
          </p>
          <SourceFacts
            rows={[
              ["Published by", "U.S. Census Bureau"],
              ["License", "Public domain"],
            ]}
          />
        </ProseSection>

        <ProseSection id="websites" title="Business websites">
          <p>
            Most facts come from each business&rsquo;s own public website, read
            politely by <TextLink to="/bot">NearbyNudgeBot</TextLink>. Every
            fact links to the page it came from, with a short quote, so you can
            check it before you send anything.
          </p>
        </ProseSection>

        <ProseSection
          id="ai"
          title={`The AI: ${AI_PROVIDER.product} by ${AI_PROVIDER.vendor}`}
        >
          <p>
            One AI model does the thinking: it plans each campaign, reads pages
            for facts, chooses the reason to get in touch, writes the draft and
            checks it. It is reached through {AI_PROVIDER.vendor}&rsquo;s API,
            the only outside service NearbyNudge uses. The{" "}
            <TextLink to="/privacy">Privacy</TextLink> page lists what it
            receives.
          </p>
        </ProseSection>

        <ProseSection id="software" title="Open-source software">
          <p>
            NearbyNudge is built with open-source software. The fonts and code
            ship inside the app, so your browser only ever talks to
            NearbyNudge&rsquo;s own server.
          </p>
          <div className="flex flex-col gap-8">
            <CreditTable caption="In your browser" credits={FRONTEND} />
            <CreditTable caption="On our server" credits={BACKEND} />
          </div>
          <p className="aside">
            Smaller libraries that these projects rely on keep their own
            licenses.
          </p>
        </ProseSection>
      </Prose>
    </>
  )
}
