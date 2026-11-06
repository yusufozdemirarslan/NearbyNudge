// Formatting helpers. Timestamps arrive as UTC ISO strings and are shown in
// the browser's time zone. All output is plain US English.
import type { FitLabel } from "@/lib/api/types"

const toDate = (value: string | Date) => (value instanceof Date ? value : new Date(value))

/** "Oct 24" this year, "Oct 24, 2025" otherwise. */
export function formatDate(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value)
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

/** "Oct 24, 3:05 PM". */
export function formatDateTime(value: string | Date, now: Date = new Date()): string {
  return `${formatDate(value, now)}, ${formatTime(value)}`
}

/** "3:05 PM". */
export function formatTime(value: string | Date): string {
  return toDate(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

/**
 * When the daily send limit resets: "midnight" when that is midnight on this computer's clock,
 * otherwise the time ("7:00 AM"), since the limit follows the time zone in the sender profile.
 */
export function formatResetTime(value: string | Date): string {
  const date = toDate(value)
  return date.getHours() === 0 && date.getMinutes() === 0 ? "midnight" : formatTime(date)
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", then "Oct 20". */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value)
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000)
  if (seconds < 45) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${plural(minutes, "minute")} ago`
  const hours = Math.round(minutes / 60)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (hours < 24 && date.getDate() === now.getDate()) return `${plural(hours, "hour")} ago`
  if (date.toDateString() === yesterday.toDateString()) return "yesterday"
  return formatDate(date, now)
}

/** "1.2 mi". */
export function formatDistance(miles: number): string {
  return `${miles.toFixed(1)} mi`
}

/**
 * "$0.04", "$12.50"; amounts under a dime keep up to four decimals so
 * per-lead AI costs stay readable ("$0.0123").
 */
export function formatMoney(usd: number, options: { precise?: boolean } = {}): string {
  const abs = Math.abs(usd)
  const digits = options.precise || (abs > 0 && abs < 0.1) ? 4 : 2
  const text = abs.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(digits, 2),
    maximumFractionDigits: digits,
  })
  return `${usd < 0 ? "-" : ""}$${text}`
}

/** "1,204". */
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US")
}

/** 0.083 → "8%"; pass digits for "8.3%". */
export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`
}

/** Fit label from a 0–100 score: Strong ≥ 80, Good 60–79, Weak < 60. */
export function fitLabel(score: number): FitLabel {
  if (score >= 80) return "Strong"
  if (score >= 60) return "Good"
  return "Weak"
}

/** "1 lead", "3 leads"; pass the plural for irregular words. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`
}

/** "less than a minute left", "about 2 minutes left". */
export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null
  if (seconds < 60) return "less than a minute left"
  const minutes = Math.round(seconds / 60)
  return `about ${plural(minutes, "minute")} left`
}

/** "48 s", "4 min 12 s", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) {
    const rest = s % 60
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`
}

/** "samplestudio.example" from "https://www.samplestudio.example/about". */
export function displayDomain(url: string | null | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./u, "")
  } catch {
    return url.replace(/^https?:\/\//u, "").replace(/\/.*$/u, "")
  }
}

/** Joins words as "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}
