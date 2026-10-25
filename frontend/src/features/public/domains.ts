/** A plain email check: something@something.tld, no spaces. The server checks again. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/** The host part of what someone typed ("https://www.example.com/about" -> "www.example.com"). */
export function hostOf(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, "")
    .replace(/^[^@/]*@/u, "")
    .replace(/[/?#].*$/u, "")
    .replace(/:\d+$/u, "")
    .replace(/\.$/u, "")
}

/** True for something that names a website: a host with a dot and no spaces. */
export function looksLikeDomain(value: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/u.test(hostOf(value))
}

/** "www.example.com" -> "example.com", for confirmations. */
export function displayHost(value: string): string {
  return hostOf(value).replace(/^www\./u, "")
}
