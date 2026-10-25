import * as React from "react"

/** Sets the tab title to "<title> · NearbyNudge" while the page is shown. */
export function useDocumentTitle(title: string | null | undefined) {
  React.useEffect(() => {
    document.title = title ? `${title} · NearbyNudge` : "NearbyNudge"
  }, [title])
}
