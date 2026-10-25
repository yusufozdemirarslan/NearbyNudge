import { Link } from "@tanstack/react-router"
import { ChevronDownIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { keyLabel } from "@/components/KeyHint"
import { useAccount, useCurrentUser, usePreferences, useUpdatePreferences } from "@/hooks/use-account"
import { useCommandMenu } from "@/hooks/use-commands"
import type { Preferences } from "@/lib/api/types"
import { useShortcutSheet } from "./ShortcutSheet"

function initials(name: string) {
  const parts = name.trim().split(/\s+/u)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase()
}

/**
 * The masthead's Options menu, under the sender's name: theme, the command
 * menu, keyboard shortcuts and Settings.
 */
export function OptionsMenu() {
  const user = useCurrentUser()
  const { data: account } = useAccount()
  const preferences = usePreferences()
  const updatePreferences = useUpdatePreferences()
  const commandMenu = useCommandMenu()
  const sheet = useShortcutSheet()
  const name = (account?.profile?.sender_name ?? user?.name ?? "").trim()
  const company = (account?.profile?.sender_company ?? "").trim()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="h-11 gap-2 px-2">
            <span className="sr-only">Options menu: </span>
            <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
              <span className="max-w-40 truncate text-ui font-semibold">{name || "Sender profile"}</span>
              <span className="max-w-40 truncate text-micro font-normal italic">{company || " "}</span>
            </span>
            <span aria-hidden="true" className="numeral text-ui sm:hidden">
              {initials(name || company || "NearbyNudge")}
            </span>
            <ChevronDownIcon aria-hidden="true" className="max-sm:hidden" />
          </Button>
        }
      />
      <DropdownMenuContent side="bottom" align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {name || "Sender profile"}
            {company ? `, ${company}` : ""}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preferences.theme}
            onValueChange={(value) => void updatePreferences({ theme: value as Preferences["theme"] })}
          >
            <DropdownMenuRadioItem value="system" closeOnClick>
              Match my computer
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light" closeOnClick>
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" closeOnClick>
              Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => commandMenu.setOpen(true)}>
          Command menu
          <DropdownMenuShortcut>{keyLabel("mod+K")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => sheet.setOpen(true)}>
          Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/settings" />}>Settings</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
