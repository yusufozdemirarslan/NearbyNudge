import * as React from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { KeyHint } from "@/components/KeyHint"
import { usePreferences, useUpdatePreferences } from "@/hooks/use-account"
import { useShortcutRegistry, useShortcuts } from "@/hooks/use-shortcuts"

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const SheetContext = React.createContext<SheetContextValue | null>(null)

/**
 * The shortcut sheet (?): lists every shortcut the current screen registered
 * through `useShortcuts`, grouped, plus the switch that turns single-key
 * shortcuts off (WCAG 2.1.4). Mount once inside ShortcutsProvider.
 */
export function ShortcutSheetProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const value = React.useMemo(() => ({ open, setOpen }), [open])

  useShortcuts(
    {
      "?": { description: "Show keyboard shortcuts", handler: () => setOpen(true) },
    },
    { group: "General" }
  )

  return (
    <SheetContext.Provider value={value}>
      {children}
      <ShortcutSheetDialog open={open} onOpenChange={setOpen} />
    </SheetContext.Provider>
  )
}

/** Opens or closes the shortcut sheet from anywhere (menus, buttons). */
export function useShortcutSheet() {
  const context = React.useContext(SheetContext)
  if (!context) throw new Error("useShortcutSheet must be used inside <ShortcutSheetProvider>.")
  return context
}

function ShortcutSheetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const registry = useShortcutRegistry()
  const preferences = usePreferences()
  const updatePreferences = useUpdatePreferences()
  const groups = open ? registry.list() : []
  const switchId = React.useId()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(40rem,calc(100vh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 pt-5 pb-4">
          <DialogTitle className="text-pane-title font-semibold">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-ui text-ink-secondary">
            Single-key shortcuts work outside text boxes. Ctrl or ⌘ shortcuts work everywhere.
          </DialogDescription>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-lg bg-muted px-3 py-2.5">
            <label htmlFor={switchId} className="text-ui font-medium">
              Single-key shortcuts
            </label>
            <Switch
              id={switchId}
              checked={preferences.shortcuts_enabled}
              onCheckedChange={(checked) => void updatePreferences({ shortcuts_enabled: checked })}
            />
          </div>
        </DialogHeader>
        <div className="overflow-y-auto px-5 py-4">
          {groups.length === 0 && <p className="text-ui text-ink-secondary">No shortcuts on this screen.</p>}
          <div className="space-y-5">
            {groups.map((group, index) => (
              <section key={group.group} aria-labelledby={`${switchId}-g${index}`}>
                <h3 id={`${switchId}-g${index}`} className="mb-1.5 text-meta font-semibold text-muted-foreground">
                  {group.group}
                </h3>
                <dl className="divide-y divide-border">
                  {group.items.map((item) => (
                    <div key={item.keys + item.description} className="flex items-center justify-between gap-4 py-1.5">
                      <dt className="text-ui text-foreground">{item.description}</dt>
                      <dd className="text-ink-secondary">
                        <KeyHint keys={item.keys} always />
                        <span className="sr-only">{item.keys}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
