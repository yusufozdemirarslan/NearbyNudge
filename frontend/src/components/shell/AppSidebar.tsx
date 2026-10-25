import { Link, useRouterState } from "@tanstack/react-router"
import {
  ChartColumnIcon,
  ChevronsUpDownIcon,
  CircleMinusIcon,
  CommandIcon,
  KeyboardIcon,
  MapIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
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
import { useAccount, useCurrentUser, usePreferences, useUpdatePreferences } from "@/hooks/use-account"
import { useCommandMenu } from "@/hooks/use-commands"
import { keyLabel } from "@/components/KeyHint"
import { useShortcutSheet } from "./ShortcutSheet"
import { BrandMark } from "./BrandMark"
import type { Preferences } from "@/lib/api/types"

export type NavPath = "/" | "/campaigns/new" | "/sent" | "/numbers" | "/dnc" | "/settings" | "/admin"

interface NavItem {
  to: NavPath
  label: string
  icon: LucideIcon
  /** Paths that also count as this item. */
  match: (pathname: string) => boolean
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    label: "Campaigns",
    icon: MapIcon,
    match: (p) => p === "/" || (/^\/campaigns\//u.test(p) && p !== "/campaigns/new"),
  },
  { to: "/campaigns/new", label: "New campaign", icon: PlusIcon, match: (p) => p === "/campaigns/new" },
  { to: "/sent", label: "Sent", icon: SendIcon, match: (p) => p.startsWith("/sent") },
  { to: "/numbers", label: "Numbers", icon: ChartColumnIcon, match: (p) => p.startsWith("/numbers") },
  { to: "/dnc", label: "Do not contact", icon: CircleMinusIcon, match: (p) => p.startsWith("/dnc") },
  { to: "/settings", label: "Settings", icon: SettingsIcon, match: (p) => p.startsWith("/settings") },
  { to: "/admin", label: "Admin", icon: ShieldCheckIcon, match: (p) => p.startsWith("/admin") },
]

function initials(name: string) {
  const parts = name.trim().split(/\s+/u)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase()
}

/** Left navigation. Collapses to an icon rail (on the review desk by default). */
export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { setOpenMobile, isMobile } = useSidebar()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-12 justify-center border-b border-sidebar-border px-3 group-data-[collapsible=icon]:px-2.5">
        <Link
          to="/"
          className="flex items-center rounded-md"
          aria-label="NearbyNudge, campaigns"
          onClick={() => isMobile && setOpenMobile(false)}
        >
          <BrandMark className="group-data-[collapsible=icon]:[&>span:last-child]:hidden" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Main">
              <SidebarMenu className="gap-0.5">
                {NAV_ITEMS.map((item) => {
                  const active = item.match(pathname)
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        className="h-9 gap-2.5 text-ui data-active:font-semibold [&_svg]:size-5"
                        render={
                          <Link
                            to={item.to}
                            aria-current={active ? "page" : undefined}
                            onClick={() => isMobile && setOpenMobile(false)}
                          />
                        }
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SenderMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/**
 * The sidebar footer: who the emails are from (the sender profile), with
 * the theme, the command menu, keyboard shortcuts and Settings.
 */
function SenderMenu() {
  const user = useCurrentUser()
  const { data: account } = useAccount()
  const preferences = usePreferences()
  const updatePreferences = useUpdatePreferences()
  const commandMenu = useCommandMenu()
  const sheet = useShortcutSheet()
  const name = (account?.profile?.sender_name ?? user?.name ?? "").trim()
  const company = (account?.profile?.sender_company ?? "").trim()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="gap-2.5 data-popup-open:bg-sidebar-accent">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-meta font-semibold text-primary-foreground"
                >
                  {initials(name || company || "NearbyNudge")}
                </span>
                <span className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="sr-only">Options menu: </span>
                  <span className="truncate text-ui font-medium">{name || "Sender profile"}</span>
                  {/* Holds its line while the account loads, so the footer doesn't jump. */}
                  <span className="truncate text-meta text-muted-foreground">{company || "\u00a0"}</span>
                </span>
                <ChevronsUpDownIcon aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent side="top" align="start" className="w-64">
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
              <CommandIcon aria-hidden="true" />
              Command menu
              <DropdownMenuShortcut>{keyLabel("mod+K")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => sheet.setOpen(true)}>
              <KeyboardIcon aria-hidden="true" />
              Keyboard shortcuts
              <DropdownMenuShortcut>?</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link to="/settings" />}>
              <SettingsIcon aria-hidden="true" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
