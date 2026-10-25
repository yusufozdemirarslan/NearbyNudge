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
  const placedRef = React.useRef<string[]>([])
  const keyRef = React.useRef("")
  // First time each id was shown (0 = part of the first render of this view).
  const seenRef = React.useRef<Map<string, number> | null>(null)
  const [resort, setResort] = React.useState(0)
  const resortRef = React.useRef(0)

  const result = React.useMemo(() => {
    if (!leads) return { rows: [] as LeadSummary[], held: [] as LeadSummary[], fresh: new Set<string>() }
    const key = `${view}|${sort}`
    const reset = key !== keyRef.current || resort !== resortRef.current
    if (reset) {
      placedRef.current = []
      keyRef.current = key
      resortRef.current = resort
    }
    const byId = new Map(leads.map((lead) => [lead.id, lead]))
    const cmp = comparator(sort)
    const pool = leads.filter((lead) => inView(view, lead.status) || lead.id === selectedId)
    const sorted = pool.slice().sort(cmp).map((lead) => lead.id)
    const poolIds = new Set(sorted)
    const previous = placedRef.current.filter((id) => poolIds.has(id))
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
    placedRef.current = placed

    // Rows that appear after the first render of this view get a soft tint
    // for about a second. Timestamps keep this stable across re-renders.
    const now = Date.now()
    if (seenRef.current === null || reset) seenRef.current = new Map(placed.map((id) => [id, 0]))
    const fresh = new Set<string>()
    for (const id of placed) {
      const first = seenRef.current.get(id)
      if (first === undefined) {
        seenRef.current.set(id, now)
        fresh.add(id)
      } else if (first > 0 && now - first < 1200) fresh.add(id)
    }
    return {
      rows: placed.map((id) => byId.get(id)!),
      held: held.map((id) => byId.get(id)!),
      fresh,
    }
  }, [leads, view, sort, selectedId, resort])

  const showHeld = React.useCallback(() => setResort((n) => n + 1), [])
  return { ...result, showHeld }
}
