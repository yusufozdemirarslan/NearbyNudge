import { Link, Outlet } from "@tanstack/react-router"
import { buttonVariants } from "@/components/ui/button"
import { BrandMark } from "./BrandMark"
import { SkipLink } from "./SkipLink"

/** Footer links shared by the public and set-up layouts. */
export function PublicFooterLinks() {
  return (
    <nav aria-label="About NearbyNudge" className="flex flex-wrap gap-x-5 gap-y-2 text-meta text-ink-secondary">
      <Link to="/bot" className="hover:text-foreground hover:underline">
        About NearbyNudgeBot
      </Link>
      <Link to="/data-sources" className="hover:text-foreground hover:underline">
        Data sources
      </Link>
      <Link to="/terms" className="hover:text-foreground hover:underline">
        Terms
      </Link>
      <Link to="/privacy" className="hover:text-foreground hover:underline">
        Privacy
      </Link>
    </nav>
  )
}

/**
 * Layout for the public pages (/bot, /data-sources, /terms, /privacy). Site
 * owners land here from NearbyNudgeBot's user agent; the header leads to the app.
 */
export function PublicLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SkipLink />
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <Link to="/" className="rounded-md" aria-label="NearbyNudge home">
            <BrandMark />
          </Link>
          <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Go to campaigns
          </Link>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 outline-none">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <PublicFooterLinks />
        </div>
      </footer>
    </div>
  )
}

/**
 * Layout for the one-time sender profile set-up (/onboarding): a calm,
 * centred column with the brand above and the public links below.
 */
export function SetupLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SkipLink />
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center px-4">
        <BrandMark />
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-8 outline-none"
      >
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 py-6">
        <PublicFooterLinks />
      </footer>
    </div>
  )
}
