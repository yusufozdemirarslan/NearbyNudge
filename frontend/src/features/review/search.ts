import type { LeadStatus } from "@/lib/api/types"

/** Status views on the review desk, in tab order. */
export const DESK_VIEWS = [
  "ready",
  "needs_review",
  "in_progress",
  "approved",
  "sent",
  "skipped",
  "failed",
  "all",
] as const
export type DeskView = (typeof DESK_VIEWS)[number]

export const DESK_SORTS = ["fit", "distance", "name"] as const
export type DeskSort = (typeof DESK_SORTS)[number]

export interface DeskSearch {
  /** Status view (tab). Missing = choose a sensible default on load. */
  view?: DeskView
  /** Selected lead id. */
  lead?: string
  /** List order; missing = fit. */
  sort?: DeskSort
}

export const VIEW_LABEL: Record<DeskView, string> = {
  ready: "Ready",
  needs_review: "Needs review",
  in_progress: "In progress",
  approved: "Approved",
  sent: "Sent",
  skipped: "Skipped",
  failed: "Couldn't finish",
  all: "All",
}

export const VIEW_STATUSES: Record<Exclude<DeskView, "all">, LeadStatus[]> = {
  ready: ["ready"],
  needs_review: ["needs_review"],
  in_progress: ["queued", "reading", "choosing", "writing", "checking"],
  approved: ["approved"],
  sent: ["sent", "replied"],
  skipped: ["skipped", "dnc"],
  failed: ["failed"],
}

/** The view a status belongs to. */
export function viewOfStatus(status: LeadStatus): Exclude<DeskView, "all"> {
  for (const view of DESK_VIEWS) {
    if (view === "all") continue
    if (VIEW_STATUSES[view].includes(status)) return view
  }
  return "ready"
}

export function inView(view: DeskView, status: LeadStatus): boolean {
  return view === "all" || VIEW_STATUSES[view].includes(status)
}

const isView = (value: unknown): value is DeskView =>
  typeof value === "string" && (DESK_VIEWS as readonly string[]).includes(value)
const isSort = (value: unknown): value is DeskSort =>
  typeof value === "string" && (DESK_SORTS as readonly string[]).includes(value)

/** TanStack Router `validateSearch` for /campaigns/$campaignId. */
export function validateDeskSearch(search: Record<string, unknown>): DeskSearch {
  return {
    view: isView(search.view) ? search.view : undefined,
    lead: typeof search.lead === "string" && search.lead.length > 0 ? search.lead : undefined,
    sort: isSort(search.sort) ? search.sort : undefined,
  }
}
