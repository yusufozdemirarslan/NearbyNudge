import { useSingleKeyShortcuts } from "@/hooks/use-shortcuts"
import { cn } from "@/lib/utils"

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent)

/** "mod+K" → ["Ctrl", "K"] (or ["⌘", "K"] on a Mac). */
export function keyParts(keys: string): string[] {
  return keys.split("+").map((part) => {
    const p = part.trim()
    const lower = p.toLowerCase()
    if (lower === "mod") return isMac ? "⌘" : "Ctrl"
    if (lower === "shift") return "Shift"
    if (lower === "alt") return isMac ? "⌥" : "Alt"
    if (lower === "enter") return "Enter"
    if (lower === "escape" || lower === "esc") return "Esc"
    return p.length === 1 ? p.toUpperCase() : p
  })
}

/** Human text for a combo, e.g. "Ctrl+K" — for aria-keyshortcuts-style labels. */
export function keyLabel(keys: string): string {
  return keyParts(keys).join("+")
}

export interface KeyHintProps {
  /** Combination like "A", "Shift+D", "mod+K", "mod+Enter" or a range "1–4". */
  keys: string
  /**
   * Show even when single-key shortcuts are turned off. Modifier shortcuts
   * (mod+K) always show.
   */
  always?: boolean
  className?: string
}

/**
 * Renders a shortcut as small key caps that inherit the surrounding text
 * color, so they read on any button. Decorative (aria-hidden): put the
 * shortcut on the control with `aria-keyshortcuts` instead.
 */
export function KeyHint({ keys, always, className }: KeyHintProps) {
  const singleEnabled = useSingleKeyShortcuts()
  const hasModifier = /mod|ctrl|alt/iu.test(keys)
  if (!singleEnabled && !hasModifier && !always) return null
  return (
    <span aria-hidden="true" data-slot="key-hint" className={cn("inline-flex items-center gap-0.5", className)}>
      {keyParts(keys).map((part, i) => (
        <kbd
          key={`${part}-${i}`}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-[color-mix(in_srgb,currentColor_13%,transparent)] px-1 font-sans text-meta leading-none font-semibold tracking-normal text-current tabular-nums"
        >
          {part}
        </kbd>
      ))}
    </span>
  )
}
