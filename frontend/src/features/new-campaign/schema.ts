import { z } from "zod"
import type { CampaignInput, SenderProfile, Tone } from "@/lib/api/types"

/** Radius choices in miles (CS1: 1–25, default 5). */
export const RADIUS_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 25] as const
export const DEFAULT_RADIUS = 5
export const MIN_LEADS = 5
export const MAX_LEADS = 25
export const DEFAULT_LEADS = 10

export const campaignSchema = z.object({
  location: z
    .string()
    .trim()
    .min(2, 'Enter a city and state, like "Arlington, VA", or a ZIP code.')
    .max(200, "Use 200 characters or fewer."),
  radius_mi: z
    .number({ error: "Choose how far to search." })
    .min(1, "Choose a radius from 1 to 25 miles.")
    .max(25, "Choose a radius from 1 to 25 miles."),
  industry: z
    .string()
    .trim()
    .min(2, 'Enter who you sell to, like "Dentists".')
    .max(120, "Use 120 characters or fewer."),
  offer_what: z
    .string()
    .trim()
    .min(3, "Describe what you sell in a few words.")
    .max(400, "Use 400 characters or fewer."),
  offer_proof: z.string().trim().max(400, "Use 400 characters or fewer."),
  offer_cta: z
    .string()
    .trim()
    .min(
      2,
      'Enter the one thing you\'d like them to do, like "Free 15-minute audit".'
    )
    .max(200, "Use 200 characters or fewer."),
  tone: z.enum(["professional", "friendly", "direct"]),
  lead_target: z
    .number({ error: `Enter a number from ${MIN_LEADS} to ${MAX_LEADS}.` })
    .int(`Use a whole number from ${MIN_LEADS} to ${MAX_LEADS}.`)
    .min(MIN_LEADS, `Choose at least ${MIN_LEADS} businesses.`)
    .max(MAX_LEADS, `Choose at most ${MAX_LEADS} businesses.`),
})

export type CampaignFormValues = z.infer<typeof campaignSchema>

/** Field order for focusing the first error. */
export const CAMPAIGN_FIELDS: (keyof CampaignFormValues)[] = [
  "location",
  "radius_mi",
  "industry",
  "offer_what",
  "offer_proof",
  "offer_cta",
  "tone",
  "lead_target",
]

/**
 * Starting values: the last campaign's inputs when there is one (brief 3.5),
 * otherwise empty fields with the profile's default tone.
 */
export function campaignDefaults(
  last: CampaignInput | null,
  profile: SenderProfile | null
): CampaignFormValues {
  const tone: Tone = last?.tone ?? profile?.default_tone ?? "professional"
  return {
    location: last?.location ?? "",
    radius_mi: last?.radius_mi ?? DEFAULT_RADIUS,
    industry: last?.industry ?? "",
    offer_what: last?.offer_what ?? "",
    offer_proof: last?.offer_proof ?? "",
    offer_cta: last?.offer_cta ?? "",
    tone,
    lead_target: last?.lead_target ?? DEFAULT_LEADS,
  }
}

const clean = (value: string | undefined) =>
  (value ?? "").split(/\s+/u).filter(Boolean).join(" ")

/** The API body for the form's values (spaces collapsed like the backend does). */
export function toCampaignInput(
  values: Partial<CampaignFormValues>
): CampaignInput {
  return {
    location: clean(values.location),
    radius_mi: Number(values.radius_mi),
    industry: clean(values.industry),
    offer_what: clean(values.offer_what),
    offer_proof: clean(values.offer_proof),
    offer_cta: clean(values.offer_cta),
    tone: (values.tone ?? "professional") as Tone,
    lead_target: Number(values.lead_target),
  }
}

/**
 * True when two inputs are the same brief. Exact comparison on purpose: the
 * server refuses to start a plan whose location, radius or industry changed
 * in any way, and any other change asks for a fresh review too.
 */
export function sameInput(a: CampaignInput, b: CampaignInput): boolean {
  return (
    a.location === b.location &&
    a.radius_mi === b.radius_mi &&
    a.industry === b.industry &&
    a.offer_what === b.offer_what &&
    a.offer_proof === b.offer_proof &&
    a.offer_cta === b.offer_cta &&
    a.tone === b.tone &&
    a.lead_target === b.lead_target
  )
}
