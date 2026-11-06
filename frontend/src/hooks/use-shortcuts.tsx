import * as React from "react"

/**
 * One keyboard shortcut.
 *
 * `keys` uses lower-case names joined by "+": "j", "shift+d", "mod+k"
 * (Ctrl on Windows/Linux, ⌘ on Mac), "mod+enter", "escape", "?", "1".
 */
export interface Shortcut {
  /** What the sheet shows, e.g. "Next lead". */
  description: string
  handler: (event: KeyboardEvent) => void
  /** Group heading in the shortcut sheet. Defaults to the hook's `group`. */
  group?: string
  /** Also fire while focus is in a text field (Escape, mod+enter). */
  allowInInputs?: boolean
  /** Fire again while the key is held down (J/K). */
  repeat?: boolean
  /** Keep out of the shortcut sheet. */
  hidden?: boolean
  /** Shown instead of `keys` in the sheet, e.g. "1–4". */
  display?: string
}

/** Map of key combination to shortcut, e.g. `{ j: { description, handler } }`. */
export type ShortcutMap = Record<string, Shortcut>

interface Registration {
  order: number
  group: string
  enabled: boolean
  map: React.RefObject<ShortcutMap>
}

interface ShortcutsContextValue {
  register: (id: number, registration: Registration) => void
  unregister: (id: number) => void
  /** Current shortcuts for the sheet, grouped, newest registrations last. */
  list: () => { group: string; items: { keys: string; description: string }[] }[]
  singleKeyEnabled: boolean
}

const ShortcutsContext = React.createContext<ShortcutsContextValue | null>(null)

let nextOrder = 1

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
])

/** True when the key press belongs to a text box (shortcuts must not fire). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === "TEXTAREA" || tag === "SELECT") return true
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((target as HTMLInputElement).type || "text")
  return target.closest("[contenteditable='true'], [role='textbox'], [role='combobox']") !== null
}

/** True when focus is inside an open menu, dialog or listbox. */
function inOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest("[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']") !== null
}

/** Normalizes a key event to the registry's "mod+shift+k" form. */
export function comboFromEvent(event: KeyboardEvent): string {
  const key = event.key
  if (key === "?") return "?"
  // A typed digit or symbol already carries Shift: many layouts need it for "/" (Turkish,
  // German) or for digits (French AZERTY). Shift only counts for letters and named keys.
  const symbol = key.length === 1 && key !== " " && key.toLowerCase() === key.toUpperCase()
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push("mod")
  if (event.altKey) parts.push("alt")
  if (event.shiftKey && !symbol) parts.push("shift")
  const name =
    key === " " ? "space" : key === "Esc" ? "escape" : key.length === 1 ? key.toLowerCase() : key.toLowerCase()
  parts.push(name)
  return parts.join("+")
}

const isSingleKey = (combo: string) => !combo.includes("mod+") && !combo.includes("alt+")

/**
 * Provides the shortcut registry and the one global key listener. Mount once.
 * Single-key shortcuts (no Ctrl/⌘/Alt) only run when `singleKeyEnabled` is
 * true (Preferences.shortcuts_enabled, WCAG 2.1.4) and never while typing.
 */
export function ShortcutsProvider({
  children,
  singleKeyEnabled,
}: {
  children: React.ReactNode
  singleKeyEnabled: boolean
}) {
  const registrations = React.useRef(new Map<number, Registration>())
  const enabledRef = React.useRef(singleKeyEnabled)
  React.useEffect(() => {
    enabledRef.current = singleKeyEnabled
  }, [singleKeyEnabled])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const combo = comboFromEvent(event)
      const typing = isTypingTarget(event.target)
      const overlay = inOverlay(event.target)
      const single = isSingleKey(combo)
      if (single && !enabledRef.current && combo !== "escape" && combo !== "shift+escape") return
      const ordered = [...registrations.current.values()]
        .filter((r) => r.enabled)
        .sort((a, b) => b.order - a.order)
      for (const registration of ordered) {
        const shortcut = registration.map.current?.[combo]
        if (!shortcut) continue
        if (typing && !shortcut.allowInInputs) return
        if (overlay && single && !shortcut.allowInInputs) return
        if (event.repeat && !shortcut.repeat) return
        event.preventDefault()
        shortcut.handler(event)
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const value = React.useMemo<ShortcutsContextValue>(
    () => ({
      register: (id, registration) => registrations.current.set(id, registration),
      unregister: (id) => registrations.current.delete(id),
      list: () => {
        const groups = new Map<string, Map<string, { keys: string; description: string }>>()
        const ordered = [...registrations.current.values()]
          .filter((r) => r.enabled)
          .sort((a, b) => a.order - b.order)
        for (const registration of ordered) {
          for (const [keys, shortcut] of Object.entries(registration.map.current ?? {})) {
            if (shortcut.hidden) continue
            const group = shortcut.group ?? registration.group
            if (!groups.has(group)) groups.set(group, new Map())
            const label = shortcut.display ?? keys
            groups.get(group)!.set(label + shortcut.description, { keys: label, description: shortcut.description })
          }
        }
        return [...groups.entries()].map(([group, items]) => ({ group, items: [...items.values()] }))
      },
      singleKeyEnabled,
    }),
    [singleKeyEnabled]
  )

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}

/**
 * Registers shortcuts while the component is mounted and `enabled` is true.
 * Later-mounted registrations win for the same key, so an open chooser (for
 * example the skip reasons on 1–4) takes over from the screen beneath it.
 *
 * @example
 * useShortcuts({ j: { description: "Next lead", handler: next, repeat: true } }, { group: "Review desk" })
 */
export function useShortcuts(
  map: ShortcutMap,
  options: { enabled?: boolean; group?: string } = {}
) {
  const context = React.useContext(ShortcutsContext)
  if (!context) throw new Error("useShortcuts must be used inside <ShortcutsProvider>.")
  const { register, unregister } = context
  const enabled = options.enabled ?? true
  const group = options.group ?? "General"
  const mapRef = React.useRef<ShortcutMap>(map)
  // Numbered at first render, so the order follows the order hooks first rendered in.
  const [id] = React.useState(() => nextOrder++)

  React.useLayoutEffect(() => {
    mapRef.current = map
  })

  React.useEffect(() => {
    register(id, { order: id, group, enabled, map: mapRef })
    return () => unregister(id)
  }, [id, enabled, group, register, unregister])
}

/** Registry access for the shortcut sheet and for showing or hiding key hints. */
export function useShortcutRegistry() {
  const context = React.useContext(ShortcutsContext)
  if (!context) throw new Error("useShortcutRegistry must be used inside <ShortcutsProvider>.")
  return context
}

/** True when single-key shortcuts are on (show KeyHints only then). */
export function useSingleKeyShortcuts(): boolean {
  return React.useContext(ShortcutsContext)?.singleKeyEnabled ?? true
}
