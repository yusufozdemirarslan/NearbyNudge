import * as React from "react"

type Politeness = "polite" | "assertive"

interface AnnounceOptions {
  /** Use "assertive" only for errors that block the user (brief §3.6). */
  politeness?: Politeness
}

type AnnounceFn = (message: string, options?: AnnounceOptions) => void

const AnnounceContext = React.createContext<AnnounceFn | null>(null)

/**
 * Renders two visually hidden live regions (polite and assertive) that stay
 * in the DOM for the whole session, so screen readers announce every message
 * (WCAG 4.1.3). Mount once near the root.
 */
export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = React.useState("")
  const [assertive, setAssertive] = React.useState("")
  const timers = React.useRef<number[]>([])

  const announce = React.useCallback<AnnounceFn>((message, options) => {
    const set = options?.politeness === "assertive" ? setAssertive : setPolite
    // Clear first so repeating the same sentence is announced again.
    set("")
    const id = window.setTimeout(() => set(message), 60)
    timers.current.push(id)
  }, [])

  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((id) => window.clearTimeout(id))
  }, [])

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </AnnounceContext.Provider>
  )
}

/**
 * Returns `announce(message, { politeness })`. Messages are read politely by
 * default: "Copied", "Marked as sent", "3 more leads ready".
 */
export function useAnnounce(): AnnounceFn {
  const announce = React.useContext(AnnounceContext)
  if (!announce) throw new Error("useAnnounce must be used inside <AnnouncerProvider>.")
  return announce
}
