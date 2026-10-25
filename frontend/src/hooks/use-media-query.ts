import * as React from "react"

/** Live result of a CSS media query, e.g. useMediaQuery("(min-width: 1280px)"). */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    [query]
  )
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}

/** Review desk layouts (brief §3.2): one pane, two columns or three columns. */
export function useDeskLayout(): "one" | "two" | "three" {
  const two = useMediaQuery("(min-width: 840px)")
  const three = useMediaQuery("(min-width: 1280px)")
  return three ? "three" : two ? "two" : "one"
}

/** True when the user asked the system to reduce motion. */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)")
}
