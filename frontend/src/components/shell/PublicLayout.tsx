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

/**
 * Layout for the public pages (/bot, /data-sources, /terms, /privacy). Site
 * owners land here from NearbyNudgeBot's user agent; the masthead leads to the app.
 */
export function PublicLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-paper">
      <SkipLink />
      <header className="border-b-(length:--rule-heavy) border-ink">
        <div className="mx-auto flex h-(--masthead) max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="NearbyNudge home">
            <BrandMark />
          </Link>
          <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Go to campaigns
          </Link>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 outline-none sm:px-6">
        <Outlet />
      </main>
      <footer className="border-t border-ink">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <PublicFooterLinks />
        </div>
      </footer>
    </div>
  )
}

/**
 * A page outside every layout (not found, a crash): the wordmark over the
 * heavy rule, then one column, so even a dead end looks like NearbyNudge.
 */
export function StandalonePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-paper">
      <header className="border-b-(length:--rule-heavy) border-ink">
        <div className="mx-auto flex h-(--masthead) max-w-5xl items-center px-4 sm:px-6">
          <Link to="/" aria-label="NearbyNudge home">
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
 * Layout for the one-time sender profile set-up (/onboarding): the masthead's
 * wordmark over a heavy rule, one column, the public links below.
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
      <footer className="border-t border-ink">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <PublicFooterLinks />
        </div>
      </footer>
    </div>
  )
}
