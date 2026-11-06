/**
 * Copies text to the clipboard. Accepts a promise for text that is still
 * being fetched: browsers that need the copy to start inside the click
 * (Safari) get a ClipboardItem with the pending text. Returns false when the
 * browser refused, so the caller can say so in place.
 */
export async function copyText(text: string | Promise<string>): Promise<boolean> {
  try {
    if (typeof text !== "string" && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const blob = text.then((value) => new Blob([value], { type: "text/plain" }))
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })])
      return true
    }
    const value = await text
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
    return legacyCopy(value)
  } catch {
    try {
      return legacyCopy(await text)
    } catch {
      return false
    }
  }
}

function legacyCopy(value: string): boolean {
  const area = document.createElement("textarea")
  area.value = value
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand("copy")
  } finally {
    area.remove()
  }
}
