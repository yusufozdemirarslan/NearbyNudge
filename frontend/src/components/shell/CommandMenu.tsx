import { useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { campaignsQuery } from "@/lib/api/queries"
import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { keyLabel } from "@/components/KeyHint"
import { usePreferences, useSavePreference } from "@/hooks/use-account"
import { useCommandMenu, type Command as CommandEntry } from "@/hooks/use-commands"
import { useShortcuts } from "@/hooks/use-shortcuts"
import { NAV_ITEMS } from "./nav"
import { useShortcutSheet } from "./ShortcutSheet"

/**
 * The command menu (Ctrl/⌘ K): navigation, theme and shortcut commands, plus
 * whatever the current screen adds with `useRegisterCommands`.
 */
export function CommandMenu() {
  const { open, setOpen, list } = useCommandMenu()
  const navigate = useNavigate()
  const preferences = usePreferences()
  const savePreference = useSavePreference()
  const sheet = useShortcutSheet()
  const campaigns = useQuery({ ...campaignsQuery(), enabled: open })

  useShortcuts(
    {
      "mod+k": {
        description: "Open the command menu",
        handler: () => setOpen(!open),
        allowInInputs: true,
      },
    },
    { group: "General" }
  )

  const run = (action: () => void) => {
    setOpen(false)
    // Let the dialog close and return focus before the action moves it.
    window.setTimeout(action, 0)
  }

  const screenCommands = open ? list() : []
  const groups = new Map<string, CommandEntry[]>()
  for (const command of screenCommands) {
    if (!groups.has(command.group)) groups.set(command.group, [])
    groups.get(command.group)!.push(command)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command menu"
      description="Type a command or a page name"
      className="sm:max-w-xl"
    >
      <Command loop>
        <CommandInput placeholder="Type a command or a page" aria-label="Command" />
        <CommandList className="max-h-[min(24rem,60vh)]">
          <CommandEmpty>No matching commands.</CommandEmpty>
          {[...groups.entries()].map(([group, commands]) => (
            <CommandGroup key={group} heading={group}>
              {commands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={`${group} ${command.label}`}
                  keywords={command.keywords}
                  disabled={command.disabled}
                  onSelect={() => run(command.run)}
                >
                  <span>{command.label}</span>
                  {command.shortcut && <CommandShortcut>{keyLabel(command.shortcut)}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {campaigns.data && campaigns.data.length > 0 && (
            <CommandGroup heading="Campaigns">
              {campaigns.data.slice(0, 12).map((campaign) => (
                <CommandItem
                  key={campaign.id}
                  value={`Open campaign ${campaign.name}`}
                  onSelect={() =>
                    run(() => void navigate({ to: "/campaigns/$campaignId", params: { campaignId: campaign.id }, search: {} }))
                  }
                >
                  <span className="truncate">{campaign.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Go to">
            {NAV_ITEMS.map((item) => (
              <CommandItem
                key={item.to}
                value={`Go to ${item.label}`}
                onSelect={() => run(() => void navigate({ to: item.to }))}
              >
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="General">
            <CommandItem value="Keyboard shortcuts help" onSelect={() => run(() => sheet.setOpen(true))}>
              <span>Keyboard shortcuts</span>
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
            <CommandItem
              value="Turn single-key shortcuts on off"
              onSelect={() => run(() => savePreference({ shortcuts_enabled: !preferences.shortcuts_enabled }))}
            >
              <span>{preferences.shortcuts_enabled ? "Turn off single-key shortcuts" : "Turn on single-key shortcuts"}</span>
            </CommandItem>
            <CommandItem value="Theme match my computer system" onSelect={() => run(() => savePreference({ theme: "system" }))}>
              <span>Theme: match my computer</span>
            </CommandItem>
            <CommandItem value="Theme light" onSelect={() => run(() => savePreference({ theme: "light" }))}>
              <span>Theme: light</span>
            </CommandItem>
            <CommandItem value="Theme dark" onSelect={() => run(() => savePreference({ theme: "dark" }))}>
              <span>Theme: dark</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
