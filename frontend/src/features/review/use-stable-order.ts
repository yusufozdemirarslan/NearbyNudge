import * as React from "react"
import type { LeadSummary } from "@/lib/api/types"
import { inView, type DeskSort, type DeskView } from "./search"

export function comparator(sort: DeskSort) {
  const byCreated = (a: LeadSummary, b: LeadSummary) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  const byFit = (a: LeadSummary, b: LeadSummary) => (b.fit_score ?? -1) - (a.fit_score ?? -1)
  if (sort === "distance") return (a: LeadSummary, b: LeadSummary) => a.distance_mi - b.distance_mi || byFit(a, b) || byCreated(a, b)
  if (sort === "name") return (a: LeadSummary, b: LeadSummary) => a.name.localeCompare(b.name) || byCreated(a, b)
  return (a: LeadSummary, b: LeadSummary) => byFit(a, b) || byCreated(a, b) || a.name.localeCompare(b.name)
}

export interface StableOrder {
  /** Rows to show, in a stable order. */
  rows: LeadSummary[]
  /** New leads that rank above the selected one, waiting behind a button. */
  held: LeadSummary[]
  /** Ids that arrived since the list was first shown (for the teal fade). */
  fresh: ReadonlySet<string>
  /** Re-sort everything now (the "N new leads above" button). */
  showHeld: () => void
}

/** What the list showed last time, and the inputs it was worked out from. */
interface Placement {
  leads: LeadSummary[] | undefined
  view: DeskView
  sort: DeskSort
  selectedId: string | undefined
  resort: number
  /** The view, sort and re-sort count of the last full sort ("" before the first). */
  placedKey: string
  placed: string[]
  rows: LeadSummary[]
  held: LeadSummary[]
  /** Every id shown since the last full sort. */
  seen: ReadonlySet<string>
  /** Ids that arrived in the latest update, after the first render of this view. */
  fresh: ReadonlySet<string>
}

const NONE: ReadonlySet<string> = new Set()

function place(
  prev: Placement | null,
  leads: LeadSummary[] | undefined,
  view: DeskView,
  sort: DeskSort,
  selectedId: string | undefined,
  resort: number
): Placement {
  const inputs = { leads, view, sort, selectedId, resort }
  if (!leads) {
    return {
      placedKey: "",
      placed: [],
      seen: NONE,
      ...prev,
      ...inputs,
      rows: [],
      held: [],
      fresh: NONE,
    }
  }
  const key = `${view}|${sort}|${resort}`
  const reset = !prev || key !== prev.placedKey
  const byId = new Map(leads.map((lead) => [lead.id, lead]))
  const cmp = comparator(sort)
  const pool = leads.filter((lead) => inView(view, lead.status) || lead.id === selectedId)
  const sorted = pool.slice().sort(cmp).map((lead) => lead.id)
  const poolIds = new Set(sorted)
  const previous = reset ? [] : prev.placed.filter((id) => poolIds.has(id))
  const previousSet = new Set(previous)

  let placed: string[]
  const held: string[] = []
  const selIndex = selectedId ? previous.indexOf(selectedId) : -1
  if (previous.length === 0 || selIndex === -1) {
    placed = sorted
  } else {
    const above = previous.slice(0, selIndex)
    const aboveSet = new Set(above)
    const selected = byId.get(selectedId!)!
    const below: string[] = []
    for (const id of sorted) {
      if (id === selectedId || aboveSet.has(id)) continue
      const isNew = !previousSet.has(id)
      if (isNew && cmp(byId.get(id)!, selected) < 0) held.push(id)
      else below.push(id)
    }
    placed = [...above, selectedId!, ...below]
  }

  // Rows that appear after the first render of this view get a soft tint.
  const seen = reset ? new Set(placed) : new Set([...prev.seen, ...placed])
  const fresh = reset ? NONE : new Set(placed.filter((id) => !prev.seen.has(id)))
  return {
    ...inputs,
    placedKey: key,
    placed,
    rows: placed.map((id) => byId.get(id)!),
    held: held.map((id) => byId.get(id)!),
    seen,
    fresh,
  }
}

/**
 * Keeps rows from moving under the cursor (brief §3.4):
 * - rows above the selected lead never change position;
 * - new or replacement leads slot in below the selected row, in order;
 * - new leads that would rank above it wait in `held` until the user asks;
 * - the selected lead stays in the list even after it leaves the view
 *   (approving a lead in "Ready" keeps it on screen until you move on).
 * Changing the view or the sort re-sorts the whole list.
 */
export function useStableOrder(
  leads: LeadSummary[] | undefined,
  view: DeskView,
  sort: DeskSort,
  selectedId: string | undefined
): StableOrder {
  const [resort, setResort] = React.useState(0)
  const [state, setState] = React.useState(() => place(null, leads, view, sort, selectedId, resort))
  let current = state
  if (
    state.leads !== leads ||
    state.view !== view ||
    state.sort !== sort ||
    state.selectedId !== selectedId ||
    state.resort !== resort
  ) {
    // The order depends on what was shown before, so it's worked out here, from the last placement.
    current = place(state, leads, view, sort, selectedId, resort)
    setState(current)
  }

  // New arrivals keep their tint for about a second; rows shown after that come in plain.
  const fresh = current.fresh
  React.useEffect(() => {
    if (fresh.size === 0) return
    const timer = window.setTimeout(() => setState((s) => (s.fresh === fresh ? { ...s, fresh: NONE } : s)), 1200)
    return () => window.clearTimeout(timer)
  }, [fresh])

  const showHeld = React.useCallback(() => setResort((n) => n + 1), [])
  return { rows: current.rows, held: current.held, fresh, showHeld }
}
