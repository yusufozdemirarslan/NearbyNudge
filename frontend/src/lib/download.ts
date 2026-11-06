/** Saves a Blob as a file through a temporary link (no new window, no outside URL). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Builds CSV text (RFC 4180 quoting) from rows of cells. Text that starts like a formula
 * (=, +, -, @, tab or carriage return) gets a leading apostrophe so spreadsheet apps show it
 * instead of running it, as the server's exports do; numbers are left as they are.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let value = cell === null || cell === undefined ? "" : String(cell)
          if (typeof cell === "string" && /^[=+\-@\t\r]/u.test(value)) value = `'${value}`
          return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value
        })
        .join(",")
    )
    .join("\r\n")
}

/** "dentists-within-5-mi-of-arlington-va" for file names. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60)
}
