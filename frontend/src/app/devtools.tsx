import * as React from "react"

/*
 * React Query devtools in development only. `import.meta.env.DEV` is false in
 * production builds, so the import below is removed and no devtools code
 * ships. Hidden during automated tests (navigator.webdriver).
 */
const Devtools = import.meta.env.DEV
  ? React.lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtools }))
    )
  : null

export function QueryDevtools() {
  if (!Devtools || navigator.webdriver) return null
  return (
    <React.Suspense fallback={null}>
      <Devtools buttonPosition="bottom-left" initialIsOpen={false} />
    </React.Suspense>
  )
}
