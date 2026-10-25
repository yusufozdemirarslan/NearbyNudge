import * as React from "react"
import { Outlet, useRouterState } from "@tanstack/react-router"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { AppSidebar, NAV_ITEMS } from "./AppSidebar"
import { CommandMenu } from "./CommandMenu"
import { PausedBanner } from "./PausedBanner"
import { ShortcutSheetProvider } from "./ShortcutSheet"
import { SkipLink } from "./SkipLink"
import { TopBar } from "./TopBar"

const TopBarSlotContext = React.createContext<(node: React.ReactNode) => void>(() => {})

/**
 * Puts page context (a breadcrumb, a campaign name) in the top bar while the
 * calling page is mounted. Pass a stable node or memoize it.
 */
export function useTopBarSlot(node: React.ReactNode) {
  const set = React.useContext(TopBarSlotContext)
  React.useEffect(() => {
    set(node)
    return () => set(null)
  }, [node, set])
}

/** True on /campaigns/$campaignId (not /campaigns/new). */
export function isDeskPath(pathname: string) {
  return /^\/campaigns\/(?!new\/?$)[^/]+\/?$/u.test(pathname)
}

function readSidebarCookie(): boolean {
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/u)
  return match ? match[1] === "true" : true
}

/**
 * The app layout (shadcn sidebar-07 pattern): skip link, left
 * navigation that collapses to an icon rail (always on the review desk),
 * the top bar with today's sending meter, the paused banner, the page, the
 * command menu (Ctrl/⌘ K) and the shortcut sheet (?).
 */
export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const desk = isDeskPath(pathname)
  const [userOpen, setUserOpen] = React.useState(readSidebarCookie)
  const [deskOpen, setDeskOpen] = React.useState(false)
  const [slot, setSlot] = React.useState<React.ReactNode>(null)
  const mainRef = React.useRef<HTMLElement>(null)
  const firstPath = React.useRef(pathname)

  React.useEffect(() => {
    if (desk) setDeskOpen(false)
  }, [desk])

  // Move focus to the new page after navigating (not on the first load and
  // not when only the search params change), so screen readers start there.
  React.useEffect(() => {
    if (firstPath.current === pathname) return
    firstPath.current = pathname
    const main = mainRef.current
    if (!main) return
    const heading = main.querySelector<HTMLElement>("h1")
    if (heading) {
      heading.setAttribute("tabindex", "-1")
      heading.focus({ preventScroll: true })
    } else {
      main.focus({ preventScroll: true })
    }
    main.scrollTop = 0
  }, [pathname])

  const section = NAV_ITEMS.find((item) => item.match(pathname))

  return (
    <SidebarProvider
      open={desk ? deskOpen : userOpen}
      onOpenChange={desk ? setDeskOpen : setUserOpen}
      className="h-svh overflow-hidden"
    >
      <ShortcutSheetProvider>
        <SkipLink />
        <AppSidebar />
        <SidebarInset className="h-svh min-w-0 overflow-hidden">
          <TopBarSlotContext.Provider value={setSlot}>
            <TopBar>
              {slot ?? (section && <span className="truncate text-ui font-medium text-foreground">{section.label}</span>)}
            </TopBar>
            <PausedBanner />
            <main
              id="main-content"
              ref={mainRef}
              tabIndex={-1}
              className={cn("min-h-0 flex-1 outline-none", desk ? "overflow-hidden" : "overflow-y-auto")}
            >
              <Outlet />
            </main>
          </TopBarSlotContext.Provider>
        </SidebarInset>
        <CommandMenu />
      </ShortcutSheetProvider>
    </SidebarProvider>
  )
}
