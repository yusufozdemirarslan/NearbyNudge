// Fictional businesses for the development-only mock adapter.
// Every name is "Sample …", every domain ends in .example and every phone
// number is in the reserved 555-01xx range.
import type { ContactKind, EditorCheck, FactState, SentenceState } from "../types"

export interface FactSpec {
  key: string
  text: string
  quote: string
  page: string // "About page"
  path: string // "/about"
  listing?: boolean
  state?: FactState
}

export interface ClaimSpec {
  text: string
  facts: string[]
  state?: SentenceState
}

export interface HookSpec {
  kind: string
  title: string
  reason: string
  facts: string[]
  claims: ClaimSpec[]
  subject: string
}

export interface SiteSpec {
  secure: boolean | null
  mobile: boolean | null
  load: number | null
  year: number | null
  booking: boolean | null
  hours: boolean | null
  prices: boolean | null
  social: string[]
}

export interface Profile {
  key: string
  name: string
  domain: string | null
  category: string
  locality: string
  distance: number
  address: string
  phone: string | null
  greeting: string
  fit: number
  fitReason: string
  contact: {
    kind: ContactKind
    email?: string
    formPath?: string
    label: string
    listing?: boolean
    note?: string
  }
  pages: { path: string; label: string }[]
  facts: FactSpec[]
  site: SiteSpec
  hooks: HookSpec[] // [chosen, alternative, alternative]
  editor?: {
    failKey?: EditorCheck["key"]
    failNote?: string
    notes?: string
    fixes?: string[]
  }
  warnings?: string[]
}

/** The sender's offer, written as email sentences. */
export interface OfferSpec {
  offer: string[]
  cta: string[]
  friendlyCta: string[]
  directCta: string[]
}

export const LISTING_LABEL = "Business listing (Overture Maps, Oct 2026)"

export const SENDER = {
  name: "Maya Chen",
  title: "Founder",
  company: "Brightline Ads",
  address: "123 Example St, Arlington, VA 22201",
}

export const FOOTER = [
  SENDER.name,
  `${SENDER.title}, ${SENDER.company}`,
  SENDER.address,
  `This email is a business offer from ${SENDER.company}.`,
  `Not interested? Reply "no thanks" and I won't email again.`,
].join("\n")

// ---------------------------------------------------------------------------
// Offers per campaign
// ---------------------------------------------------------------------------

export const DENTAL_OFFER: OfferSpec = {
  offer: [
    "At Brightline Ads, we run Google Ads for dental practices and send searchers straight to a simple online booking page.",
    "For a Fairfax practice, that approach grew new bookings by 30 percent in three months.",
  ],
  cta: [
    "Would a free 15-minute audit of your local search ads be useful?",
    "I can share what I would change and roughly what it would cost.",
  ],
  friendlyCta: [
    "Would you be open to a free 15-minute audit of your local search ads?",
    "No pressure either way, and I'm happy to share ideas even if the timing isn't right.",
  ],
  directCta: ["Can I send you a free 15-minute audit of your search ads this week?"],
}

export const HVAC_OFFER: OfferSpec = {
  offer: [
    "At Brightline Ads, we run Google Ads for home service companies and focus on calls that turn into booked jobs.",
    "Last spring we doubled tune-up calls for an HVAC company in Vienna.",
  ],
  cta: [
    "Would a free 15-minute audit of your current ads be useful?",
    "I can walk you through what I would change before the busy season.",
  ],
  friendlyCta: [
    "Would you be open to a free 15-minute look at your current ads?",
    "Happy to share a few ideas either way.",
  ],
  directCta: ["Can I send you a free 15-minute ads audit this week?"],
}

export const LAW_OFFER: OfferSpec = {
  offer: [
    "At Brightline Ads, we run Google Ads for law firms and track every call back to the search that started it.",
    "For a Fairfax firm, we cut the cost per consultation by 40 percent.",
  ],
  cta: [
    "Would a free 15-minute audit of your search ads be useful?",
    "I can show you where the budget goes today and what I would change.",
  ],
  friendlyCta: [
    "Would you be open to a free 15-minute audit of your search ads?",
    "Glad to share what I find, with no obligation.",
  ],
  directCta: ["Can I send you a free 15-minute ads audit this week?"],
}

export const GENERIC_OFFER: OfferSpec = {
  offer: [
    "At Brightline Ads, we help local businesses turn nearby searches into calls and bookings.",
    "Most clients see results within the first two months.",
  ],
  cta: [
    "Would a free 15-minute audit of your local search presence be useful?",
    "I can share what I would change and what it might cost.",
  ],
  friendlyCta: [
    "Would you be open to a free 15-minute look at your local search presence?",
    "Happy to share ideas either way.",
  ],
  directCta: ["Can I send you a free 15-minute audit this week?"],
}

// ---------------------------------------------------------------------------
// Live campaign: Dentists within 5 mi of Arlington, VA
// ---------------------------------------------------------------------------

const listingFact = (category: string): FactSpec => ({
  key: "listing",
  text: `Listed as a ${category.toLowerCase()} at this address.`,
  quote: `Category: ${category}. Status: open.`,
  page: LISTING_LABEL,
  path: "",
  listing: true,
})

export const STUDIO: Profile = {
  key: "studio",
  name: "Sample Dental Studio",
  domain: "samplestudio.example",
  category: "Dentist",
  locality: "Arlington, VA",
  distance: 1.2,
  address: "1400 Example Blvd, Suite 210, Arlington, VA 22201",
  phone: "(703) 555-0100",
  greeting: "Hi Dr. Lee,",
  fit: 92,
  fitReason: "Books by phone only; fits your Google Ads offer.",
  contact: { kind: "email", email: "office@samplestudio.example", label: "Contact page" },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/about", label: "About page" },
    { path: "/contact", label: "Contact page" },
    { path: "/services", label: "Services page" },
  ],
  facts: [
    {
      key: "since",
      text: "Family practice serving Arlington since 2009.",
      quote: "Proudly serving Arlington families since 2009.",
      page: "About page",
      path: "/about",
    },
    {
      key: "phone",
      text: "New patients book by phone only.",
      quote: "To schedule a visit, please call our front desk during office hours.",
      page: "Home page",
      path: "/",
    },
    {
      key: "emergency",
      text: "Offers same-day emergency appointments on weekdays.",
      quote: "Same-day emergency appointments are available Monday through Friday.",
      page: "Services page",
      path: "/services",
    },
    {
      key: "insurance",
      text: "Accepts most PPO insurance plans.",
      quote: "We accept most PPO dental insurance plans.",
      page: "Services page",
      path: "/services",
    },
    {
      key: "owner",
      text: "Dr. Jordan Lee founded the practice.",
      quote: "Dr. Jordan Lee founded Sample Dental Studio after twelve years in practice.",
      page: "About page",
      path: "/about",
    },
    listingFact("General dentist"),
  ],
  site: { secure: true, mobile: false, load: 2.8, year: 2019, booking: false, hours: true, prices: false, social: ["Facebook"] },
  hooks: [
    {
      kind: "no_online_booking",
      title: "Online booking",
      reason: "They take every booking by phone, and your offer sends searchers to an online booking page.",
      facts: ["phone"],
      subject: "Online booking at Sample Dental Studio?",
      claims: [
        {
          text: "Your About page says you have served Arlington families since 2009, which is a real advantage in a crowded market.",
          facts: ["since"],
        },
        {
          text: "I also noticed that new patients still have to call your front desk to book a visit.",
          facts: ["phone"],
        },
      ],
    },
    {
      kind: "other",
      title: "Same-day emergencies",
      reason: "Same-day emergency care is a strong ad message for people searching for an emergency dentist nearby.",
      facts: ["emergency"],
      subject: "Emergency visits at Sample Dental Studio",
      claims: [
        {
          text: "Your Services page says you offer same-day emergency appointments on weekdays.",
          facts: ["emergency"],
        },
        {
          text: "That is exactly what people search for when a tooth starts hurting.",
          facts: [],
        },
      ],
    },
    {
      kind: "good_news",
      title: "Serving Arlington since 2009",
      reason: "Seventeen years in the same neighborhood is a trust signal worth putting in ads.",
      facts: ["since"],
      subject: "Since 2009 in Arlington, Sample Dental Studio",
      claims: [
        {
          text: "Your About page says you have cared for Arlington families since 2009.",
          facts: ["since"],
        },
        {
          text: "That kind of track record is a strong reason for new families to choose you.",
          facts: [],
        },
      ],
    },
  ],
  editor: { fixes: ["Shortened the subject from 12 to 6 words"] },
}

export const FAMILY: Profile = {
  key: "family",
  name: "Sample Family Dental",
  domain: "samplefamily.example",
  category: "Dentist",
  locality: "Arlington, VA",
  distance: 2.0,
  address: "2210 Example Ave, Arlington, VA 22203",
  phone: "(703) 555-0114",
  greeting: "Hello,",
  fit: 88,
  fitReason: "Open Saturdays but never mentions it in search; good match for search ads.",
  contact: { kind: "form", formPath: "/contact", label: "Contact page" },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/hours", label: "Hours page" },
    { path: "/contact", label: "Contact page" },
  ],
  facts: [
    {
      key: "saturday",
      text: "Sees patients on Saturday mornings.",
      quote: "We are open Saturdays from 8 a.m. to 1 p.m.",
      page: "Hours page",
      path: "/hours",
    },
    {
      key: "special",
      text: "New patient exam, X-rays and cleaning for $99.",
      quote: "New patients: exam, X-rays and cleaning for $99.",
      page: "Home page",
      path: "/",
    },
    {
      key: "callback",
      text: "Appointment requests get a call back within one business day.",
      quote: "Request an appointment and our team will call you back within one business day.",
      page: "Contact page",
      path: "/contact",
    },
    {
      key: "area",
      text: "Cares for families in Arlington and Falls Church.",
      quote: "Caring for families in Arlington and Falls Church.",
      page: "Home page",
      path: "/",
    },
    listingFact("General dentist"),
  ],
  site: { secure: true, mobile: true, load: 1.9, year: 2025, booking: false, hours: true, prices: true, social: ["Facebook", "Instagram"] },
  hooks: [
    {
      kind: "good_news",
      title: "Saturday hours",
      reason: "Saturday availability is a strong ad message that their search results don't mention.",
      facts: ["saturday"],
      subject: "Saturday hours at Sample Family Dental",
      claims: [
        {
          text: "Your Hours page says you see patients on Saturday mornings, which many offices nearby don't offer.",
          facts: ["saturday"],
        },
        {
          text: "Your $99 new patient visit also gives families a clear reason to choose you.",
          facts: ["special"],
        },
      ],
    },
    {
      kind: "no_online_booking",
      title: "Call-back booking",
      reason: "Requests wait up to a day for a call back; online booking would capture people while they search.",
      facts: ["callback"],
      subject: "Faster booking for Sample Family Dental",
      claims: [
        {
          text: "Your Contact page says appointment requests get a call back within one business day.",
          facts: ["callback"],
        },
        { text: "Many searchers book with whoever confirms first.", facts: [] },
      ],
    },
    {
      kind: "missing_prices",
      title: "$99 new patient visit",
      reason: "A clear price is rare in dental ads and tends to lift clicks.",
      facts: ["special"],
      subject: "Your $99 new patient visit",
      claims: [
        {
          text: "Your Home page offers new patients an exam, X-rays and a cleaning for $99.",
          facts: ["special"],
        },
        { text: "A clear price like that stands out in search ads.", facts: [] },
      ],
    },
  ],
}

export const PEDIATRIC: Profile = {
  key: "pediatric",
  name: "Sample Pediatric Dentistry",
  domain: "samplekids.example",
  category: "Pediatric dentist",
  locality: "Arlington, VA",
  distance: 2.6,
  address: "3100 Example Rd, Arlington, VA 22207",
  phone: "(703) 555-0127",
  greeting: "Hi Dr. Patel,",
  fit: 84,
  fitReason: "Growing practice with plans to expand; ads can fill a new schedule.",
  contact: { kind: "email", email: "hello@samplekids.example", label: "Contact page" },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/about", label: "About page" },
    { path: "/contact", label: "Contact page" },
  ],
  facts: [
    {
      key: "kids",
      text: "Cares for children from their first tooth to their teen years.",
      quote: "Gentle dental care for kids from first tooth to teen years.",
      page: "Home page",
      path: "/",
    },
    {
      key: "second",
      text: "Plans to open a second location.",
      quote: "We're planning a second location to serve more families.",
      page: "About page",
      path: "/about",
      state: "check",
    },
    {
      key: "new",
      text: "Welcomes new patients up to age 18.",
      quote: "Now welcoming new patients of all ages up to 18.",
      page: "Home page",
      path: "/",
    },
    listingFact("Pediatric dentist"),
  ],
  site: { secure: true, mobile: true, load: 2.2, year: 2026, booking: true, hours: true, prices: false, social: ["Instagram"] },
  hooks: [
    {
      kind: "good_news",
      title: "Second location",
      reason: "A new location needs a steady stream of nearby searches to fill its schedule.",
      facts: ["second"],
      subject: "Your second office, Sample Pediatric Dentistry",
      claims: [
        {
          text: "Your Home page says you care for kids from their first tooth to their teen years.",
          facts: ["kids"],
        },
        {
          text: "Congratulations on opening your second office this year.",
          facts: ["second"],
          state: "check",
        },
      ],
    },
    {
      kind: "other",
      title: "New patients welcome",
      reason: "They are accepting new patients, so ads would bring work they can take on now.",
      facts: ["new"],
      subject: "New patients at Sample Pediatric Dentistry",
      claims: [
        {
          text: "Your Home page says you are welcoming new patients up to age 18.",
          facts: ["new"],
        },
        { text: "Parents searching nearby are often ready to book right away.", facts: [] },
      ],
    },
    {
      kind: "other",
      title: "First tooth to teens",
      reason: "Care across every age is a simple message parents respond to.",
      facts: ["kids"],
      subject: "Parents searching near Sample Pediatric Dentistry",
      claims: [
        {
          text: "Your Home page says you care for kids from their first tooth to their teen years.",
          facts: ["kids"],
        },
        { text: "That is the exact promise parents look for in search results.", facts: [] },
      ],
    },
  ],
  editor: {
    failKey: "facts",
    failNote: "The email says a second office opened; the About page only says one is planned.",
    notes:
      "Check the sentence about a second office. The About page says it is planned, not open. Edit the sentence or choose another hook.",
    fixes: [],
  },
  warnings: ["1 sentence needs checking: the second office is planned, not open."],
}

export const ORTHO: Profile = {
  key: "ortho",
  name: "Sample Orthodontics",
  domain: "sampleortho.example",
  category: "Orthodontist",
  locality: "Arlington, VA",
  distance: 3.4,
  address: "4500 Example Pkwy, Arlington, VA 22204",
  phone: "(703) 555-0131",
  greeting: "Hi Dr. Nguyen,",
  fit: 81,
  fitReason: "Offers free consultations, an easy message for search ads.",
  contact: { kind: "email", email: "smile@sampleortho.example", label: "Contact page" },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/treatments", label: "Treatments page" },
    { path: "/hours", label: "Hours page" },
    { path: "/contact", label: "Contact page" },
  ],
  facts: [
    {
      key: "aligners",
      text: "Offers clear aligners and traditional braces.",
      quote: "Choose from clear aligners or traditional braces.",
      page: "Treatments page",
      path: "/treatments",
    },
    {
      key: "consult",
      text: "The first consultation is free.",
      quote: "Your first consultation is free.",
      page: "Home page",
      path: "/",
    },
    {
      key: "thursday",
      text: "Sees patients until 7 p.m. on Thursdays.",
      quote: "Thursday appointments until 7 p.m.",
      page: "Hours page",
      path: "/hours",
    },
    listingFact("Orthodontist"),
  ],
  site: { secure: true, mobile: true, load: 3.6, year: 2022, booking: true, hours: true, prices: false, social: ["Instagram"] },
  hooks: [
    {
      kind: "other",
      title: "Free consultation",
      reason: "A free first visit is exactly what people compare when choosing an orthodontist.",
      facts: ["consult"],
      subject: "Free consults at Sample Orthodontics",
      claims: [
        {
          text: "Your Home page offers a free first consultation, which is what people look for when they compare orthodontists.",
          facts: ["consult"],
        },
        { text: "You also offer both clear aligners and braces.", facts: ["aligners"] },
      ],
    },
    {
      kind: "other",
      title: "Clear aligners",
      reason: "Aligner searches are growing and convert well for practices that offer both options.",
      facts: ["aligners"],
      subject: "Clear aligner searches near Sample Orthodontics",
      claims: [
        { text: "Your Treatments page says you offer clear aligners as well as braces.", facts: ["aligners"] },
        { text: "Adults searching for aligners often book within a week.", facts: [] },
      ],
    },
    {
      kind: "missing_hours",
      title: "Thursday evenings",
      reason: "Evening hours suit working parents and teens after school.",
      facts: ["thursday"],
      subject: "Thursday evenings at Sample Orthodontics",
      claims: [
        { text: "Your Hours page says you see patients until 7 p.m. on Thursdays.", facts: ["thursday"] },
        { text: "Evening slots are a strong message for busy families.", facts: [] },
      ],
    },
  ],
}

export const SMILES: Profile = {
  key: "smiles",
  name: "Sample Smiles",
  domain: "samplesmiles.example",
  category: "Dentist",
  locality: "Arlington, VA",
  distance: 4.1,
  address: "880 Example Ave, Arlington, VA 22204",
  phone: "(703) 555-0142",
  greeting: "Hi Dr. Okafor,",
  fit: 90,
  fitReason: "Just opened a new office; ads can help fill the first months.",
  contact: { kind: "email", email: "frontdesk@samplesmiles.example", label: "Contact page" },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/news", label: "News page" },
    { path: "/services", label: "Services page" },
    { path: "/contact", label: "Contact page" },
  ],
  facts: [
    {
      key: "office",
      text: "Opened a new office on Example Avenue in March 2026.",
      quote: "Our new office on Example Avenue opened in March 2026.",
      page: "News page",
      path: "/news",
    },
    {
      key: "whitening",
      text: "Offers whitening in a single visit.",
      quote: "Professional whitening in a single visit.",
      page: "Services page",
      path: "/services",
    },
    {
      key: "online",
      text: "Patients can book online.",
      quote: "Book online in under a minute.",
      page: "Home page",
      path: "/",
    },
    listingFact("General dentist"),
  ],
  site: { secure: true, mobile: true, load: 1.4, year: 2026, booking: true, hours: true, prices: true, social: ["Facebook", "Instagram", "YouTube"] },
  hooks: [
    {
      kind: "good_news",
      title: "New office",
      reason: "A new office needs a few months of steady nearby searches to fill its schedule.",
      facts: ["office"],
      subject: "Your new office, Sample Smiles",
      claims: [
        {
          text: "Congratulations on the new office on Example Avenue, which your News page says opened in March.",
          facts: ["office"],
        },
        { text: "New offices often need a few months of steady search traffic to fill the schedule.", facts: [] },
      ],
    },
    {
      kind: "other",
      title: "Single-visit whitening",
      reason: "Whitening is a popular search that converts well for practices with online booking.",
      facts: ["whitening"],
      subject: "Whitening searches near Sample Smiles",
      claims: [
        { text: "Your Services page offers professional whitening in a single visit.", facts: ["whitening"] },
        { text: "Paired with your online booking, that is an easy ad to run.", facts: ["online"] },
      ],
    },
    {
      kind: "other",
      title: "Online booking",
      reason: "Online booking means ad clicks can turn into visits without a phone call.",
      facts: ["online"],
      subject: "Ads that book straight into Sample Smiles",
      claims: [
        { text: "Your Home page says patients can book online in under a minute.", facts: ["online"] },
        { text: "That makes every ad click a chance to book right away.", facts: [] },
      ],
    },
  ],
}

export const DENTAL_CARE: Profile = {
  key: "care",
  name: "Sample Dental Care",
  domain: "sampledentalcare.example",
  category: "Dentist",
  locality: "Arlington, VA",
  distance: 3.9,
  address: "1700 Example St, Arlington, VA 22209",
  phone: "(703) 555-0150",
  greeting: "Hello,",
  fit: 70,
  fitReason: "",
  contact: { kind: "none", label: "" },
  pages: [{ path: "/", label: "Home page" }],
  facts: [],
  site: { secure: true, mobile: false, load: 2.1, year: 2021, booking: false, hours: false, prices: false, social: [] },
  hooks: [],
}

export const ARTS: Profile = {
  key: "arts",
  name: "Sample Dental Arts",
  domain: "sampledentalarts.example",
  category: "Cosmetic dentist",
  locality: "Arlington, VA",
  distance: 2.8,
  address: "2600 Example Blvd, Arlington, VA 22201",
  phone: "(703) 555-0163",
  greeting: "Hello,",
  fit: 74,
  fitReason: "Cosmetic work has high-value searches that suit paid ads.",
  contact: { kind: "email", email: "hello@sampledentalarts.example", label: LISTING_LABEL, listing: true },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/services", label: "Services page" },
  ],
  facts: [
    {
      key: "implants",
      text: "Offers dental implant consultations.",
      quote: "Implant consultations available by appointment.",
      page: "Services page",
      path: "/services",
    },
    {
      key: "veneers",
      text: "Offers porcelain veneers.",
      quote: "Custom porcelain veneers designed in our office.",
      page: "Services page",
      path: "/services",
    },
    listingFact("Cosmetic dentist"),
  ],
  site: { secure: false, mobile: false, load: 4.9, year: 2016, booking: false, hours: true, prices: false, social: [] },
  hooks: [
    {
      kind: "other",
      title: "Implant consultations",
      reason: "Implant searches are high value and their site doesn't support them well.",
      facts: ["implants"],
      subject: "Implant searches near Sample Dental Arts",
      claims: [
        { text: "Your Services page says you offer implant consultations by appointment.", facts: ["implants"] },
        { text: "People researching implants often compare several offices online first.", facts: [] },
      ],
    },
    {
      kind: "other",
      title: "Porcelain veneers",
      reason: "Veneers are a high-value cosmetic search.",
      facts: ["veneers"],
      subject: "Veneer searches near Sample Dental Arts",
      claims: [
        { text: "Your Services page says you design custom porcelain veneers in your office.", facts: ["veneers"] },
        { text: "That is a strong message for people comparing cosmetic dentists.", facts: [] },
      ],
    },
    {
      kind: "site_gap",
      title: "Site isn't secure",
      reason: "Browsers warn visitors on sites without a secure connection, which costs ad clicks.",
      facts: ["listing"],
      subject: "A quick fix for Sample Dental Arts",
      claims: [
        { text: "Your business listing describes the practice as cosmetic dentistry.", facts: ["listing"] },
        { text: "Ads work best when the page they lead to loads quickly and securely.", facts: [] },
      ],
    },
  ],
}

export const SMILE_CENTER: Profile = {
  key: "center",
  name: "Sample Smile Center",
  domain: "samplesmilecenter.example",
  category: "Dentist",
  locality: "Arlington, VA",
  distance: 4.6,
  address: "5100 Example Rd, Arlington, VA 22205",
  phone: "(703) 555-0175",
  greeting: "Hello,",
  fit: 71,
  fitReason: "Late weekday hours suit commuters; no published email.",
  contact: { kind: "none", label: "", note: "Skipped a contact form that says no solicitations." },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/hours", label: "Hours page" },
  ],
  facts: [
    {
      key: "wednesday",
      text: "Open until 8 p.m. on Wednesdays.",
      quote: "Wednesday hours: 9 a.m. to 8 p.m.",
      page: "Hours page",
      path: "/hours",
    },
    {
      key: "emergency",
      text: "Offers same-day emergency visits.",
      quote: "Call us for same-day emergency visits.",
      page: "Home page",
      path: "/",
    },
    listingFact("General dentist"),
  ],
  site: { secure: true, mobile: true, load: 2.4, year: 2024, booking: false, hours: true, prices: false, social: ["Facebook"] },
  hooks: [
    {
      kind: "missing_hours",
      title: "Wednesday evenings",
      reason: "Evening hours are a strong message for commuters searching after work.",
      facts: ["wednesday"],
      subject: "Wednesday evenings at Sample Smile Center",
      claims: [
        { text: "Your Hours page says you are open until 8 p.m. on Wednesdays.", facts: ["wednesday"] },
        { text: "Commuters searching after work are a good audience for that.", facts: [] },
      ],
    },
    {
      kind: "other",
      title: "Same-day emergencies",
      reason: "Emergency searches are urgent and convert quickly.",
      facts: ["emergency"],
      subject: "Emergency visits at Sample Smile Center",
      claims: [
        { text: "Your Home page says you offer same-day emergency visits.", facts: ["emergency"] },
        { text: "People with a toothache usually call the first office they find.", facts: [] },
      ],
    },
    {
      kind: "no_online_booking",
      title: "Phone-only booking",
      reason: "They don't offer online booking.",
      facts: ["emergency"],
      subject: "Booking at Sample Smile Center",
      claims: [
        { text: "Your Home page asks patients to call for same-day visits.", facts: ["emergency"] },
        { text: "Online booking would catch people who search late at night.", facts: [] },
      ],
    },
  ],
}

export const GENTLE: Profile = {
  key: "gentle",
  name: "Sample Gentle Dental",
  domain: "samplegentle.example",
  category: "Dentist",
  locality: "Arlington, VA",
  distance: 4.8,
  address: "3300 Example Ln, Arlington, VA 22201",
  phone: "(703) 555-0188",
  greeting: "Hi Dr. Brooks,",
  fit: 64,
  fitReason: "Sedation dentistry is a niche search; smaller practice.",
  editor: {
    failKey: "facts",
    failNote: "One sentence makes a claim that no saved page supports.",
    notes:
      "The sentence about patients from the Clarendon offices has no source. Remove it, or rewrite it so it doesn't claim something we can't show.",
    fixes: ["Removed the word \"best\" from the subject"],
  },
  warnings: ["1 sentence has no source."],
  contact: { kind: "email", email: "care@samplegentle.example", label: "Contact page" },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/services", label: "Services page" },
    { path: "/contact", label: "Contact page" },
  ],
  facts: [
    {
      key: "sedation",
      text: "Offers sedation options for anxious patients.",
      quote: "Sedation options for anxious patients.",
      page: "Services page",
      path: "/services",
    },
    {
      key: "metro",
      text: "Two blocks from the Clarendon Metro station.",
      quote: "Located two blocks from the Clarendon Metro station.",
      page: "Contact page",
      path: "/contact",
    },
    listingFact("General dentist"),
  ],
  site: { secure: true, mobile: true, load: 2.0, year: 2023, booking: false, hours: true, prices: false, social: [] },
  hooks: [
    {
      kind: "other",
      title: "Sedation for anxious patients",
      reason: "People who avoid the dentist search for sedation before they book.",
      facts: ["sedation"],
      subject: "Anxious patients at Sample Gentle Dental",
      claims: [
        { text: "Your Services page says you offer sedation options for anxious patients.", facts: ["sedation"] },
        { text: "Many of your patients already come from the Clarendon offices nearby.", facts: [], state: "no_source" },
        { text: "People who put off dental visits often search for exactly that.", facts: [] },
      ],
    },
    {
      kind: "other",
      title: "Near the Metro",
      reason: "Being near the Metro matters to commuters.",
      facts: ["metro"],
      subject: "Commuters near Sample Gentle Dental",
      claims: [
        { text: "Your Contact page says you are two blocks from the Clarendon Metro station.", facts: ["metro"] },
        { text: "That is an easy message for commuters searching nearby.", facts: [] },
      ],
    },
    {
      kind: "no_online_booking",
      title: "Phone booking",
      reason: "No online booking on the site.",
      facts: ["listing"],
      subject: "Booking at Sample Gentle Dental",
      claims: [
        { text: "Your business listing describes the practice as general dentistry.", facts: ["listing"] },
        { text: "Online booking would let searchers book without calling.", facts: [] },
      ],
    },
  ],
}

export const BRIGHT: Profile = {
  key: "bright",
  name: "Sample Bright Dental",
  domain: "samplebright.example",
  category: "Dentist",
  locality: "Arlington, VA",
  distance: 1.8,
  address: "950 Example St, Arlington, VA 22203",
  phone: "(703) 555-0109",
  greeting: "Hi Dr. Rivera,",
  fit: 86,
  fitReason: "Invisalign provider with weak search presence.",
  contact: { kind: "email", email: "team@samplebright.example", label: "Contact page" },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/contact", label: "Contact page" },
  ],
  facts: [
    {
      key: "invisalign",
      text: "Has offered Invisalign since 2018.",
      quote: "Invisalign provider since 2018.",
      page: "Home page",
      path: "/",
    },
    {
      key: "parking",
      text: "Free parking behind the building.",
      quote: "Free parking behind the building.",
      page: "Contact page",
      path: "/contact",
    },
    listingFact("General dentist"),
  ],
  site: { secure: true, mobile: true, load: 2.6, year: 2024, booking: false, hours: true, prices: false, social: ["Facebook"] },
  hooks: [
    {
      kind: "other",
      title: "Invisalign provider",
      reason: "Invisalign searches are high intent and they have years of experience.",
      facts: ["invisalign"],
      subject: "Invisalign searches near Sample Bright Dental",
      claims: [
        { text: "Your Home page says you have offered Invisalign since 2018.", facts: ["invisalign"] },
        { text: "People searching for aligners often pick the provider with the most experience.", facts: [] },
      ],
    },
    {
      kind: "other",
      title: "Free parking",
      reason: "Parking is a real concern near Arlington offices.",
      facts: ["parking"],
      subject: "Free parking at Sample Bright Dental",
      claims: [
        { text: "Your Contact page mentions free parking behind the building.", facts: ["parking"] },
        { text: "That is a small detail that wins patients in busy areas.", facts: [] },
      ],
    },
    {
      kind: "no_online_booking",
      title: "Phone booking",
      reason: "No online booking.",
      facts: ["listing"],
      subject: "Booking at Sample Bright Dental",
      claims: [
        { text: "Your business listing describes the practice as general dentistry.", facts: ["listing"] },
        { text: "Online booking would let searchers book on the spot.", facts: [] },
      ],
    },
  ],
}

export const WELLNESS: Profile = {
  key: "wellness",
  name: "Sample Dental Wellness",
  domain: "samplewellness.example",
  category: "Dentist",
  locality: "Arlington, VA",
  distance: 4.4,
  address: "4100 Example Ave, Arlington, VA 22207",
  phone: "(703) 555-0193",
  greeting: "Hello,",
  fit: 69,
  fitReason: "Holistic dentistry is a clear niche for search ads.",
  contact: { kind: "email", email: "info@samplewellness.example", label: "Contact page" },
  pages: [
    { path: "/", label: "Home page" },
    { path: "/patients", label: "Patients page" },
    { path: "/contact", label: "Contact page" },
  ],
  facts: [
    {
      key: "holistic",
      text: "Practices holistic, mercury-free dentistry.",
      quote: "Holistic, mercury-free dentistry for the whole family.",
      page: "Home page",
      path: "/",
    },
    {
      key: "forms",
      text: "New patient forms are downloads, not online.",
      quote: "Download the new patient form and bring it to your first visit.",
      page: "Patients page",
      path: "/patients",
    },
    listingFact("General dentist"),
  ],
  site: { secure: true, mobile: true, load: 3.1, year: 2023, booking: false, hours: true, prices: false, social: ["Instagram"] },
  hooks: [
    {
      kind: "other",
      title: "Holistic dentistry",
      reason: "Holistic dentistry is a niche that people search for by name.",
      facts: ["holistic"],
      subject: "Holistic dentistry searches near you",
      claims: [
        { text: "Your Home page says you practice holistic, mercury-free dentistry.", facts: ["holistic"] },
        { text: "People who want that usually search for it by name.", facts: [] },
      ],
    },
    {
      kind: "no_online_booking",
      title: "Paper patient forms",
      reason: "Downloadable forms add a step before the first visit.",
      facts: ["forms"],
      subject: "First visits at Sample Dental Wellness",
      claims: [
        { text: "Your Patients page asks new patients to download a form before their visit.", facts: ["forms"] },
        { text: "An online form would remove a step for busy families.", facts: [] },
      ],
    },
    {
      kind: "other",
      title: "Family dentistry",
      reason: "Family care is a broad, steady search.",
      facts: ["holistic"],
      subject: "Families searching near Sample Dental Wellness",
      claims: [
        { text: "Your Home page says your care is for the whole family.", facts: ["holistic"] },
        { text: "Family searches are steady all year.", facts: [] },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Compact profiles for the finished campaigns and for new mock campaigns
// ---------------------------------------------------------------------------

interface Template {
  text: string
  quote: string
  page: string
  path: string
  claim: string
  title: string
  reason: string
  subject: (name: string) => string
  kind: string
}

const TEMPLATES: Record<"hvac" | "law" | "dental" | "generic", Template[]> = {
  hvac: [
    {
      text: "Offers 24/7 emergency repair.",
      quote: "Emergency repair available 24 hours a day, 7 days a week.",
      page: "Services page",
      path: "/services",
      claim: "Your Services page says you offer emergency repair around the clock.",
      title: "24/7 emergency repair",
      reason: "Emergency searches spike in cold snaps and convert fast.",
      subject: (n) => `Emergency calls for ${n}`,
      kind: "seasonal",
    },
    {
      text: "Sells seasonal tune-up plans.",
      quote: "Join our comfort club for two tune-ups a year.",
      page: "Plans page",
      path: "/plans",
      claim: "Your Plans page offers a comfort club with two tune-ups a year.",
      title: "Tune-up plans",
      reason: "Tune-up plans are a steady fall message.",
      subject: (n) => `Fall tune-ups at ${n}`,
      kind: "seasonal",
    },
    {
      text: "Family owned since 1998.",
      quote: "Family owned and operated since 1998.",
      page: "About page",
      path: "/about",
      claim: "Your About page says the business has been family owned since 1998.",
      title: "Family owned since 1998",
      reason: "Longevity builds trust for in-home services.",
      subject: (n) => `${n}, family owned since 1998`,
      kind: "good_news",
    },
  ],
  law: [
    {
      text: "Offers a free first consultation.",
      quote: "Schedule a free initial consultation.",
      page: "Home page",
      path: "/",
      claim: "Your Home page offers a free initial consultation.",
      title: "Free consultation",
      reason: "Free consultations are what people compare when they choose a firm.",
      subject: (n) => `Free consultations at ${n}`,
      kind: "other",
    },
    {
      text: "Handles divorce, custody and support cases.",
      quote: "Divorce, custody and support cases.",
      page: "Practice areas page",
      path: "/practice-areas",
      claim: "Your Practice areas page lists divorce, custody and support cases.",
      title: "Family law cases",
      reason: "Family law searches are local and high intent.",
      subject: (n) => `Family law searches near ${n}`,
      kind: "other",
    },
    {
      text: "Office is steps from the courthouse.",
      quote: "Steps from the Alexandria courthouse.",
      page: "Contact page",
      path: "/contact",
      claim: "Your Contact page says the office is steps from the courthouse.",
      title: "Next to the courthouse",
      reason: "Location matters for clients with court dates.",
      subject: (n) => `Clients near the courthouse, ${n}`,
      kind: "other",
    },
  ],
  dental: [
    {
      text: "Offers Saturday appointments.",
      quote: "Saturday appointments available.",
      page: "Hours page",
      path: "/hours",
      claim: "Your Hours page says you offer Saturday appointments.",
      title: "Saturday hours",
      reason: "Weekend hours are a strong message for working families.",
      subject: (n) => `Saturday hours at ${n}`,
      kind: "good_news",
    },
    {
      text: "Accepts new patients.",
      quote: "Now accepting new patients.",
      page: "Home page",
      path: "/",
      claim: "Your Home page says you are accepting new patients.",
      title: "New patients welcome",
      reason: "They can take on new patients now.",
      subject: (n) => `New patients at ${n}`,
      kind: "other",
    },
    {
      text: "Books by phone only.",
      quote: "Call our office to schedule an appointment.",
      page: "Contact page",
      path: "/contact",
      claim: "Your Contact page asks patients to call to schedule.",
      title: "Phone-only booking",
      reason: "Online booking would catch searchers outside office hours.",
      subject: (n) => `Online booking at ${n}?`,
      kind: "no_online_booking",
    },
  ],
  generic: [
    {
      text: "Family owned since 2004.",
      quote: "Family owned and operated since 2004.",
      page: "About page",
      path: "/about",
      claim: "Your About page says the business has been family owned since 2004.",
      title: "Family owned since 2004",
      reason: "Longevity is a trust signal worth featuring.",
      subject: (n) => `${n}, family owned since 2004`,
      kind: "good_news",
    },
    {
      text: "Offers free estimates.",
      quote: "Call today for a free estimate.",
      page: "Home page",
      path: "/",
      claim: "Your Home page offers free estimates.",
      title: "Free estimates",
      reason: "Free estimates lower the barrier for new customers.",
      subject: (n) => `Free estimates at ${n}`,
      kind: "other",
    },
    {
      text: "Open on Saturdays.",
      quote: "Open Saturdays 9 to 2.",
      page: "Hours page",
      path: "/hours",
      claim: "Your Hours page says you are open on Saturdays.",
      title: "Saturday hours",
      reason: "Weekend availability stands out.",
      subject: (n) => `Saturdays at ${n}`,
      kind: "missing_hours",
    },
  ],
}

export type IndustryKind = keyof typeof TEMPLATES

export function industryKind(industry: string): IndustryKind {
  const text = industry.toLowerCase()
  if (/dent|ortho/u.test(text)) return "dental"
  if (/hvac|heat|air|plumb|furnace/u.test(text)) return "hvac"
  if (/law|legal|attorney/u.test(text)) return "law"
  return "generic"
}

export function offerFor(kind: IndustryKind): OfferSpec {
  if (kind === "dental") return DENTAL_OFFER
  if (kind === "hvac") return HVAC_OFFER
  if (kind === "law") return LAW_OFFER
  return GENERIC_OFFER
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/gu, "and")
    .replace(/[^a-z0-9]+/gu, "")
    .replace(/^sample/u, "sample")

/** Builds a compact but complete profile from industry templates. */
export function compactProfile(input: {
  name: string
  category: string
  locality: string
  distance: number
  fit: number
  kind: IndustryKind
  seed: number
  street: string
  zip: string
  areaCode: string
  phoneSuffix: string
  contact?: "email" | "form" | "none"
}): Profile {
  const templates = TEMPLATES[input.kind]
  const order = [0, 1, 2].map((i) => templates[(i + input.seed) % templates.length])
  const domain = `${slug(input.name)}.example`
  const facts: FactSpec[] = order.map((t, i) => ({
    key: `f${i}`,
    text: t.text,
    quote: t.quote,
    page: t.page,
    path: t.path,
  }))
  facts.push(listingFact(input.category))
  const contactKind = input.contact ?? "email"
  const hooks: HookSpec[] = order.map((t, i) => ({
    kind: t.kind,
    title: t.title,
    reason: t.reason,
    facts: [`f${i}`],
    subject: t.subject(input.name),
    claims: [
      { text: t.claim, facts: [`f${i}`] },
      {
        text:
          i === 0
            ? `It's a detail that sets ${input.name} apart from others nearby.`
            : "That is a clear message for people searching nearby.",
        facts: [],
      },
    ],
  }))
  return {
    key: domain,
    name: input.name,
    domain,
    category: input.category,
    locality: input.locality,
    distance: input.distance,
    address: `${input.street}, ${input.locality} ${input.zip}`,
    phone: `(${input.areaCode}) 555-01${input.phoneSuffix}`,
    greeting: "Hello,",
    fit: input.fit,
    fitReason: `${order[0].title} fits your offer; ${input.distance <= 3 ? "close by" : "within range"}.`,
    contact:
      contactKind === "email"
        ? { kind: "email", email: `office@${domain}`, label: "Contact page" }
        : contactKind === "form"
          ? { kind: "form", formPath: "/contact", label: "Contact page" }
          : { kind: "none", label: "" },
    pages: [
      { path: "/", label: "Home page" },
      ...order.filter((t) => t.path !== "/").map((t) => ({ path: t.path, label: t.page })),
    ],
    facts,
    site: {
      secure: input.seed % 4 !== 0,
      mobile: input.seed % 3 !== 0,
      load: 1.5 + ((input.seed * 7) % 30) / 10,
      year: 2018 + (input.seed % 8),
      booking: input.seed % 2 === 0,
      hours: true,
      prices: input.seed % 3 === 1,
      social: input.seed % 2 === 0 ? ["Facebook"] : ["Facebook", "Instagram"],
    },
    hooks,
  }
}

/** Fictional business names per industry, for new mock campaigns. */
export function namePool(kind: IndustryKind, industry: string): string[] {
  if (kind === "dental")
    return ["Sample Park Dental", "Sample Dental Group", "Sample Smile Studio", "Sample Bright Smiles", "Sample Family Dentistry", "Sample Dental Loft", "Sample Corner Dental", "Sample Dental House", "Sample Oak Dental", "Sample River Dental", "Sample Dental Point", "Sample Main St Dental", "Sample Dental Co.", "Sample Ridge Dental", "Sample Village Dental", "Sample Dental Center", "Sample Grove Dental", "Sample Hill Dental", "Sample Dental Works", "Sample Harbor Dental", "Sample Lake Dental", "Sample Dental Place", "Sample Maple Dental", "Sample Dental Square", "Sample Cedar Dental"]
  if (kind === "hvac")
    return ["Sample Heating & Air", "Sample Comfort Systems", "Sample Air Pros", "Sample HVAC Services", "Sample Climate Co.", "Sample Cooling & Heating", "Sample Furnace Repair", "Sample Duct Masters", "Sample Home Comfort", "Sample Mechanical", "Sample Air Quality", "Sample Heat Pump Co.", "Sample Airflow", "Sample Thermal", "Sample Vent Works", "Sample Breeze HVAC", "Sample Warmth Co.", "Sample Chill Pros", "Sample Boiler Co.", "Sample Air Experts", "Sample Fresh Air", "Sample Indoor Air", "Sample Temp Control", "Sample Season HVAC", "Sample Comfort Pros"]
  if (kind === "law")
    return ["Sample Law Group", "Sample Legal Partners", "Sample & Associates", "Sample Family Law", "Sample Injury Lawyers", "Sample Estate Planning", "Sample Immigration Law", "Sample Defense Firm", "Sample Trial Lawyers", "Sample Business Law", "Sample Law Office", "Sample Counsel", "Sample Legal Aid", "Sample Law Center", "Sample Advocates", "Sample Attorneys", "Sample Law Partners", "Sample Legal Group", "Sample Litigation", "Sample Law PLLC", "Sample Justice Law", "Sample Civil Law", "Sample Elder Law", "Sample Tax Law", "Sample Law Firm"]
  const noun = industry.trim().replace(/s$/iu, "") || "Business"
  const title = noun.charAt(0).toUpperCase() + noun.slice(1)
  return Array.from({ length: 25 }, (_, i) => {
    const suffixes = ["Co.", "Group", "Studio", "Pros", "Works", "Partners", "Center", "Shop", "Services", "House"]
    return `Sample ${title} ${suffixes[i % suffixes.length]}${i >= suffixes.length ? ` ${Math.floor(i / suffixes.length) + 1}` : ""}`
  })
}
