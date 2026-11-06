import * as React from "react"

/** One entry in the command menu (Ctrl/⌘ K). */
export interface Command {
  /** Stable id, unique within the screen that registers it. */
  id: string
  label: string
  /** Group heading, e.g. "Review desk", "Go to". */
  group: string
  /** Extra words that should match the search, e.g. ["email", "send"]. */
  keywords?: string[]
  /** Shortcut to show next to the label, e.g. "A" or "Shift+D". */
  shortcut?: string
  /** Lucide icon component. */
  icon?: React.ComponentType<{ className?: string }>
  disabled?: boolean
  run: () => void
}

interface CommandsContextValue {
  register: (id: number, commands: React.RefObject<Command[]>) => void
  unregister: (id: number) => void
  /** All registered commands, screens registered later listed first. */
  list: () => Command[]
  open: boolean
  setOpen: (open: boolean) => void
}

const CommandsContext = React.createContext<CommandsContextValue | null>(null)
let nextId = 1

/** Holds the command registry and the menu's open state. Mount once. */
export function CommandsProvider({ children }: { children: React.ReactNode }) {
  const registry = React.useRef(new Map<number, React.RefObject<Command[]>>())
  const [open, setOpen] = React.useState(false)
  const value = React.useMemo<CommandsContextValue>(
    () => ({
      register: (id, commands) => registry.current.set(id, commands),
      unregister: (id) => registry.current.delete(id),
      list: () =>
        [...registry.current.entries()]
          .sort((a, b) => b[0] - a[0])
          .flatMap(([, ref]) => ref.current ?? []),
      open,
      setOpen,
    }),
    [open]
  )
  return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>
}

/**
 * Adds commands to the command menu while the component is mounted. Pass a
 * fresh array each render; the menu reads the latest one when it opens.
 *
 * @example
 * useRegisterCommands([{ id: "approve", label: "Approve", group: "Review desk", shortcut: "A", run: approve }])
 */
export function useRegisterCommands(commands: Command[]) {
  const context = React.useContext(CommandsContext)
  if (!context) throw new Error("useRegisterCommands must be used inside <CommandsProvider>.")
  const { register, unregister } = context
  const ref = React.useRef<Command[]>(commands)
  // Numbered at first render, so screens rendered later sort first.
  const [id] = React.useState(() => nextId++)
  React.useLayoutEffect(() => {
    ref.current = commands
  })
  React.useEffect(() => {
    register(id, ref)
    return () => unregister(id)
  }, [id, register, unregister])
}

/** Open state and the command list, for the menu itself. */
export function useCommandMenu() {
  const context = React.useContext(CommandsContext)
  if (!context) throw new Error("useCommandMenu must be used inside <CommandsProvider>.")
  return context
}
