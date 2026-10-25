// Small helpers for the development-only mock adapter.

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** ISO timestamp `ms` milliseconds before now. */
export function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** Next local midnight as an ISO string (when the daily send cap resets). */
export function nextLocalMidnight(): string {
  const next = new Date()
  next.setHours(24, 0, 0, 0)
  return next.toISOString()
}

/** Monday of the week containing `date`, as "2026-10-19". */
export function mondayOf(date: Date): string {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/** Deep copy so callers (the query cache) never share objects with the store. */
export function clone<T>(value: T): T {
  return structuredClone(value)
}

let counter = 1000
/** Short unique ids like "a1001". */
export function uid(prefix: string): string {
  counter += 1
  return `${prefix}${counter.toString(36)}`
}

/** Read a number from localStorage (mock controls), with a fallback. */
export function mockSetting(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null || raw === "") return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

/** Waits like a network call; rejects with AbortError when the signal aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The request was cancelled.", "AbortError"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("The request was cancelled.", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** Typical API latency for the mock: 90–260 ms. */
export function latency(): Promise<void> {
  return delay(90 + Math.round(Math.random() * 170))
}

/** RFC 6068 mailto link with subject and body (CRLF line breaks). */
export function buildMailto(to: string, subject: string, body: string): string {
  const encode = (text: string) =>
    encodeURIComponent(text.replace(/\r?\n/gu, "\r\n"))
  return `mailto:${to}?subject=${encode(subject)}&body=${encode(body)}`
}

/** Registrable-ish domain from a site URL ("samplestudio.example"). */
export function domainOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./u, "")
  } catch {
    return null
  }
}

/** Text fragment link that jumps to the quote (`#:~:text=`). */
export function fragmentUrl(url: string, quote: string): string {
  const words = quote.split(/\s+/u)
  const target =
    words.length > 8
      ? `${encodeURIComponent(words.slice(0, 4).join(" "))},${encodeURIComponent(words.slice(-3).join(" "))}`
      : encodeURIComponent(quote)
  return `${url}#:~:text=${target}`
}
