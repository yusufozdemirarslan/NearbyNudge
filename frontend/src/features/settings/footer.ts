import type { SenderProfile } from "@/lib/api/types"

/** The opt-out line every footer ends with (WR2). Must match the backend's footer. */
export const OPT_OUT_LINE = 'Not interested? Reply "no thanks" and I won\'t email again.'

type FooterFields = Pick<SenderProfile, "sender_name" | "sender_title" | "sender_company" | "sender_address">

const oneLine = (value: string) => value.split(/\s+/u).filter(Boolean).join(" ")

/** Address lines as the backend keeps them: trimmed, inner spaces collapsed, blank lines dropped. */
export function addressLines(address: string): string[] {
  return address
    .replace(/\r/gu, "")
    .split("\n")
    .map(oneLine)
    .filter(Boolean)
}

/**
 * One footer line, or null when the value it needs is still empty, so the
 * preview can show a quiet placeholder in its place.
 */
export interface FooterLine {
  key: string
  text: string | null
  placeholder?: string
}

/**
 * The locked email footer, line by line, built the same way as the backend
 * (emailtext.build_footer): name; "title, company" or company; the address
 * lines; a blank line; the business-offer line; the opt-out line.
 */
export function footerLines(profile: FooterFields): FooterLine[] {
  const name = oneLine(profile.sender_name)
  const title = oneLine(profile.sender_title)
  const company = oneLine(profile.sender_company)
  const address = addressLines(profile.sender_address)
  const lines: FooterLine[] = [
    { key: "name", text: name || null, placeholder: "Your name" },
    {
      key: "company",
      text: company ? (title ? `${title}, ${company}` : company) : null,
      placeholder: title ? `${title}, your company` : "Your company",
    },
  ]
  if (address.length === 0) lines.push({ key: "address", text: null, placeholder: "Your postal address" })
  address.forEach((line, index) => lines.push({ key: `address-${index}`, text: line }))
  lines.push({ key: "blank", text: "" })
  lines.push({
    key: "offer",
    text: company ? `This email is a business offer from ${company}.` : null,
    placeholder: "This email is a business offer from your company.",
  })
  lines.push({ key: "optout", text: OPT_OUT_LINE })
  return lines
}

/** The footer as plain text (what the backend returns as `footer_preview`). */
export function buildFooter(profile: FooterFields): string {
  return footerLines(profile)
    .map((line) => line.text ?? line.placeholder ?? "")
    .join("\n")
}
