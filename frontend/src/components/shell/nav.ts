export type NavPath = "/" | "/campaigns/new" | "/sent" | "/numbers" | "/dnc" | "/settings" | "/admin"

export interface NavItem {
  to: NavPath
  label: string
  /** Paths that also count as this item. */
  match: (pathname: string) => boolean
}

/** The main navigation, in the masthead, the phone index and the command menu. */
export const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    label: "Campaigns",
    match: (p) => p === "/" || (/^\/campaigns\//u.test(p) && p !== "/campaigns/new"),
  },
  { to: "/campaigns/new", label: "New campaign", match: (p) => p === "/campaigns/new" },
  { to: "/sent", label: "Sent", match: (p) => p.startsWith("/sent") },
  { to: "/numbers", label: "Numbers", match: (p) => p.startsWith("/numbers") },
  { to: "/dnc", label: "Do not contact", match: (p) => p.startsWith("/dnc") },
  { to: "/settings", label: "Settings", match: (p) => p.startsWith("/settings") },
  { to: "/admin", label: "Admin", match: (p) => p.startsWith("/admin") },
]

/** True on /campaigns/$campaignId (not /campaigns/new). */
export function isDeskPath(pathname: string) {
  return /^\/campaigns\/(?!new\/?$)[^/]+\/?$/u.test(pathname)
}
