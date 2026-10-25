// Word-level diff for "Show changes" after a rewrite. Each change can be kept
// (the new words) or reverted (the old words); `compose` rebuilds the text.

/** A token is a word, a space or a paragraph break ("\n\n"). */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const match of text.matchAll(/\n\s*\n|\s+|[^\s]+/gu)) {
    const token = match[0]
    if (/^\s+$/u.test(token)) tokens.push(token.includes("\n") ? (/\n\s*\n/u.test(token) ? "\n\n" : "\n") : " ")
    else tokens.push(token)
  }
  return tokens
}

export type Hunk =
  | { kind: "same"; tokens: string[] }
  | { kind: "change"; id: number; removed: string[]; added: string[] }

/** Longest-common-subsequence diff of two token lists, grouped into hunks. */
export function diffText(before: string, after: string): Hunk[] {
  const a = tokenize(before)
  const b = tokenize(after)
  const n = a.length
  const m = b.length
  // lcs[i][j] = LCS length of a[i:] and b[j:]
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const ops: { op: "same" | "del" | "add"; token: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: "same", token: a[i] })
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ op: "del", token: a[i] })
      i += 1
    } else {
      ops.push({ op: "add", token: b[j] })
      j += 1
    }
  }
  while (i < n) ops.push({ op: "del", token: a[i++] })
  while (j < m) ops.push({ op: "add", token: b[j++] })

  // Group, then merge changes separated only by a single space so a reworded
  // phrase is one change instead of several.
  const hunks: Hunk[] = []
  let id = 0
  for (const { op, token } of ops) {
    const last = hunks[hunks.length - 1]
    if (op === "same") {
      if (last?.kind === "same") last.tokens.push(token)
      else hunks.push({ kind: "same", tokens: [token] })
    } else {
      if (last?.kind !== "change") hunks.push({ kind: "change", id: id++, removed: [], added: [] })
      const change = hunks[hunks.length - 1] as Extract<Hunk, { kind: "change" }>
      if (op === "del") change.removed.push(token)
      else change.added.push(token)
    }
  }
  const merged: Hunk[] = []
  for (let k = 0; k < hunks.length; k++) {
    const hunk = hunks[k]
    const prev = merged[merged.length - 1]
    const next = hunks[k + 1]
    if (
      hunk.kind === "same" &&
      hunk.tokens.length === 1 &&
      hunk.tokens[0] === " " &&
      prev?.kind === "change" &&
      next?.kind === "change"
    ) {
      prev.removed.push(" ", ...next.removed)
      prev.added.push(" ", ...next.added)
      k += 1
      continue
    }
    merged.push(hunk)
  }
  // Renumber after merging.
  let n2 = 0
  for (const hunk of merged) if (hunk.kind === "change") hunk.id = n2++
  return merged
}

/** Rebuilds text: reverted changes use the old words, others the new ones. */
export function compose(hunks: Hunk[], reverted: ReadonlySet<number>): string {
  return hunks
    .map((hunk) =>
      hunk.kind === "same" ? hunk.tokens.join("") : (reverted.has(hunk.id) ? hunk.removed : hunk.added).join("")
    )
    .join("")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/ {2,}/gu, " ")
    .trim()
}

/** Number of changes in a diff. */
export function changeCount(hunks: Hunk[]): number {
  return hunks.filter((hunk) => hunk.kind === "change").length
}
