import type { Email, Fact, Sentence } from "@/lib/api/types"

/** Writing rules (WR1): body 80–130 words, subject under 10 words. */
export const BODY_MIN_WORDS = 80
export const BODY_MAX_WORDS = 130
export const SUBJECT_MAX_WORDS = 10

/** Counts words the way the counters show them (whitespace separated). */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/u).length
}

/** The text of one paragraph (its sentences joined by spaces). */
export function paragraphText(paragraph: Sentence[]): string {
  return paragraph.map((sentence) => sentence.text).join(" ")
}

/**
 * Builds the `UpdateEmailRequest.body` format: greeting line, blank line,
 * paragraphs separated by blank lines, blank line, signoff line.
 */
export function composeBody(
  email: Pick<Email, "greeting" | "paragraphs" | "signoff">
): string {
  const parts = [email.greeting, ...email.paragraphs.map(paragraphText), email.signoff]
  return parts.filter((part) => part.trim().length > 0).join("\n\n")
}

/** Splits a paragraph into sentences (kept simple: ., ? or ! then a space). */
export function splitSentences(paragraph: string): string[] {
  const clean = paragraph.replace(/\s+/gu, " ").trim()
  if (!clean) return []
  return clean
    .split(/(?<=[.?!]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

/**
 * Parses the body format back into greeting, paragraphs (as sentences) and
 * signoff. A body with fewer than three blocks keeps what it can.
 */
export function parseBody(body: string): {
  greeting: string
  paragraphs: string[][]
  signoff: string
} {
  const blocks = body
    .replace(/\r\n/gu, "\n")
    .split(/\n\s*\n/u)
    .map((block) => block.replace(/\n/gu, " ").trim())
    .filter(Boolean)
  if (blocks.length === 0) return { greeting: "", paragraphs: [], signoff: "" }
  if (blocks.length === 1) return { greeting: "", paragraphs: [splitSentences(blocks[0])], signoff: "" }
  const greeting = blocks[0]
  const signoff = blocks.length > 2 ? blocks[blocks.length - 1] : ""
  const middle = blocks.length > 2 ? blocks.slice(1, -1) : blocks.slice(1)
  return { greeting, paragraphs: middle.map(splitSentences), signoff }
}

/** Word count of greeting + body + signoff (the footer is excluded). */
export function bodyWordCount(body: string): number {
  return countWords(body)
}

/**
 * Numbers the facts an email cites by first appearance: the first fact cited
 * in reading order is [1], the next new one [2], and so on.
 */
export function factNumbers(email: Pick<Email, "paragraphs"> | null | undefined) {
  const numbers = new Map<string, number>()
  if (!email) return numbers
  for (const paragraph of email.paragraphs) {
    for (const sentence of paragraph) {
      for (const factId of sentence.fact_ids) {
        if (!numbers.has(factId)) numbers.set(factId, numbers.size + 1)
      }
    }
  }
  return numbers
}

/** The first sentence that cites each fact, keyed by fact id. */
export function firstCitingSentence(email: Pick<Email, "paragraphs"> | null | undefined) {
  const first = new Map<string, string>()
  if (!email) return first
  for (const paragraph of email.paragraphs) {
    for (const sentence of paragraph) {
      for (const factId of sentence.fact_ids) {
        if (!first.has(factId)) first.set(factId, sentence.id)
      }
    }
  }
  return first
}

/** Claim sentences that still need a person to look at them. */
export function claimProblems(email: Pick<Email, "paragraphs"> | null | undefined) {
  const problems: Sentence[] = []
  if (!email) return problems
  for (const paragraph of email.paragraphs) {
    for (const sentence of paragraph) {
      if (sentence.state === "check" || sentence.state === "no_source") problems.push(sentence)
    }
  }
  return problems
}

/** Facts the current email uses, in citation order, then any other used ones. */
export function usedFacts(email: Pick<Email, "paragraphs"> | null | undefined, facts: Fact[]) {
  const numbers = factNumbers(email)
  const cited = facts
    .filter((fact) => numbers.has(fact.id))
    .sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0))
  const extra = facts.filter((fact) => fact.used && !numbers.has(fact.id))
  return [...cited, ...extra]
}
