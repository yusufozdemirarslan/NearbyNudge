import * as React from "react"
import type { Email } from "@/lib/api/types"

/** A rewrite (or wrong-fact rewrite) in flight for one lead. */
export interface PendingRewrite {
  /** Words for the status line: "shorter", "another hook", "removing a wrong fact". */
  label: string
  controller: AbortController | null
}

/** The versions shown by "Show changes" and which changes the user reverted. */
export interface ChangeSnapshot {
  before: Email
  after: Email
  /** Keys of reverted changes: "subject:2", "body:5". */
  reverted: string[]
}

/** One undoable action, newest last. */
export interface UndoEntry {
  actionId: string
  leadId: string
  leadName: string
  /** "Approved", "Skipped", "Marked as sent"… */
  label: string
}

interface DeskStore {
  /** Fact highlighted by hovering or focusing a marker or a fact. */
  activeFactId: string | null
  setActiveFactId: (id: string | null) => void
  pending: Record<string, PendingRewrite | undefined>
  setPending: (leadId: string, value: PendingRewrite | null) => void
  snapshots: Record<string, ChangeSnapshot | undefined>
  setSnapshot: (leadId: string, value: ChangeSnapshot | null) => void
  undoStack: UndoEntry[]
  pushUndo: (entry: UndoEntry) => void
  dropUndo: (actionId: string) => void
  /** Multi-select for bulk skip / export. */
  checked: ReadonlySet<string>
  setChecked: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
  /** Sentence elements in the email, for lining facts up beside them. */
  sentenceEls: React.RefObject<Map<string, HTMLElement>>
  /** Bumps when sentence positions may have changed. */
  layoutTick: number
  bumpLayout: () => void
}

const DeskContext = React.createContext<DeskStore | null>(null)

/** State shared by the review desk's columns. One per open campaign. */
export function DeskStateProvider({ children }: { children: React.ReactNode }) {
  const [activeFactId, setActiveFactId] = React.useState<string | null>(null)
  const [pending, setPendingState] = React.useState<Record<string, PendingRewrite | undefined>>({})
  const [snapshots, setSnapshots] = React.useState<Record<string, ChangeSnapshot | undefined>>({})
  const [undoStack, setUndoStack] = React.useState<UndoEntry[]>([])
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(() => new Set())
  const [layoutTick, setLayoutTick] = React.useState(0)
  const sentenceEls = React.useRef(new Map<string, HTMLElement>())

  const value = React.useMemo<DeskStore>(
    () => ({
      activeFactId,
      setActiveFactId,
      pending,
      setPending: (leadId, next) =>
        setPendingState((current) => ({ ...current, [leadId]: next ?? undefined })),
      snapshots,
      setSnapshot: (leadId, next) => setSnapshots((current) => ({ ...current, [leadId]: next ?? undefined })),
      undoStack,
      pushUndo: (entry) => setUndoStack((current) => [...current.filter((e) => e.actionId !== entry.actionId), entry].slice(-50)),
      dropUndo: (actionId) => setUndoStack((current) => current.filter((e) => e.actionId !== actionId)),
      checked,
      setChecked,
      sentenceEls,
      layoutTick,
      bumpLayout: () => setLayoutTick((tick) => tick + 1),
    }),
    [activeFactId, pending, snapshots, undoStack, checked, layoutTick]
  )
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>
}

/** The desk store, or null outside the review desk (e.g. on the Sent screen). */
export function useDeskOptional(): DeskStore | null {
  return React.useContext(DeskContext)
}

export function useDesk(): DeskStore {
  const store = React.useContext(DeskContext)
  if (!store) throw new Error("useDesk must be used inside <DeskStateProvider>.")
  return store
}
