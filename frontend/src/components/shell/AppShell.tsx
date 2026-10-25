import * as React from "react"
import { Outlet, useRouterState } from "@tanstack/react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { CommandMenu } from "./CommandMenu"
import { Masthead } from "./Masthead"
import { isDeskPath } from "./nav"
import { PausedBanner } from "./PausedBanner"
import { ShortcutSheetProvider } from "./ShortcutSheet"
import { SkipLink } from "./SkipLink"

/**
 * The app layout: skip link, the masthead (navigation, today's sends, the
 * Options menu), the paused banner, the page, the command menu (Ctrl/⌘ K) and
 * the shortcut sheet (?). The review desk fills the window and scrolls inside
 * its own panes; every other page scrolls in <main>.
 */
export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const desk = isDeskPath(pathname)
  const mainRef = React.useRef<HTMLElement>(null)
  const firstPath = React.useRef(pathname)

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

  return (
    <TooltipProvider>
      <ShortcutSheetProvider>
        <SkipLink />
        <div className="flex h-svh flex-col overflow-hidden bg-paper">
          <Masthead />
          <PausedBanner />
          <main
            id="main-content"
            ref={mainRef}
            tabIndex={-1}
            // relative: hidden (sr-only) text is absolutely positioned; without a positioned
            // ancestor it escapes this scroller and stretches the whole document.
            className={cn("relative min-h-0 flex-1 outline-none", desk ? "overflow-hidden" : "overflow-y-auto")}
          >
            <Outlet />
          </main>
        </div>
        <CommandMenu />
      </ShortcutSheetProvider>
    </TooltipProvider>
  )
}
