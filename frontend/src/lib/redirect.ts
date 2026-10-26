/** Only a path on this site may follow sign-in: never another site, and never the sign-in page again. */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined
  if (/^\/login(?:[/?#]|$)/u.test(value)) return undefined
  return value
}
