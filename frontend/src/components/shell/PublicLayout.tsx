import type * as React from "react"
import { Link, Outlet } from "@tanstack/react-router"
import { buttonVariants } from "@/components/ui/button"
import { BrandMark } from "./BrandMark"
import { SkipLink } from "./SkipLink"

/** Footer links shared by the public and set-up layouts. */
export function PublicFooterLinks() {
  return (
    <nav aria-label="About NearbyNudge" className="flex flex-wrap gap-x-6 gap-y-2 text-meta">
      <Link to="/bot" className="underline-offset-4 hover:underline">
        About NearbyNudgeBot
      </Link>
      <Link to="/data-sources" className="underline-offset-4 hover:underline">
        Data sources
      </Link>
      <Link to="/terms" className="underline-offset-4 hover:underline">
        Terms
      </Link>
      <Link to="/privacy" className="underline-offset-4 hover:underline">
        Privacy
      </Link>
    </nav>
  )
}

/** The public and set-up footer, under a 1px ink rule: the name at half size, then the public links. */
function SiteFooter() {
  return (
    <footer className="border-t border-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:gap-8 sm:px-6">
        <BrandMark size="sm" />
        <PublicFooterLinks />
      </div>
    </footer>
  )
}

/**
 * Layout for the public pages (/bot, /data-sources, /terms, /privacy). Site
 * owners land here from NearbyNudgeBot's user agent; the masthead leads to the app.
 */
export function PublicLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-paper">
      <SkipLink />
      <header className="border-b-(length:--rule-heavy) border-ink">
        <div className="mx-auto flex h-(--masthead) max-w-5xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
          <Link to="/" aria-label="NearbyNudge home" className="min-w-0 [--focus-offset:4px]">
            <BrandMark />
          </Link>
          <Link to="/" className={buttonVariants({ variant: "outline", size: "sm", className: "max-sm:px-2.5" })}>
            Go to campaigns
          </Link>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 outline-none sm:px-6">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}

/**
 * A page outside every layout (not found, a crash): the One Step mark and name
 * over the heavy rule, then one column, so even a dead end looks like NearbyNudge.
 */
export function StandalonePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-paper">
      <header className="border-b-(length:--rule-heavy) border-ink">
        <div className="mx-auto flex h-(--masthead) max-w-5xl items-center px-4 sm:px-6">
          <Link to="/" aria-label="NearbyNudge home" className="[--focus-offset:4px]">
            <BrandMark />
          </Link>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 outline-none sm:px-6 sm:py-14">
        {children}
      </main>
    </div>
  )
}

/**
 * Layout for the one-time sender profile set-up (/onboarding): the One Step mark
 * and name over a heavy rule, one column, the brand and public links below.
 */
export function SetupLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-paper">
      <SkipLink />
      <header className="border-b-(length:--rule-heavy) border-ink">
        <div className="mx-auto flex h-(--masthead) max-w-5xl items-center px-4 sm:px-6">
          <BrandMark />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-10 outline-none sm:px-6">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
