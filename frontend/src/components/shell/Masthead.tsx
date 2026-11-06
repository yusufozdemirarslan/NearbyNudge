import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { MenuIcon } from "lucide-react"
import { Meter } from "@/components/Meter"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useAccount } from "@/hooks/use-account"
import { cn } from "@/lib/utils"
import { BrandMark } from "./BrandMark"
import { NAV_ITEMS } from "./nav"
import { OptionsMenu } from "./OptionsMenu"

/**
 * The masthead over every app page: the One Step mark and name, the main navigation (the
 * heavy rule turns red under the current page), today's sends against the
 * daily cap, the month's allowance and the Options menu. Under 1024px the
 * navigation folds into a Menu button that opens the index as a sheet.
 * Where the inline navigation leaves no room (1024–1439px) and under 360px the
 * mark stands alone; the link keeps the name for assistive technology.
 */
export function Masthead() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: account } = useAccount()
  const sending = account?.sending
  const usage = account?.usage
  const atCap = sending ? sending.sent_today >= sending.daily_cap : false

  return (
    <header
      data-slot="top-bar"
      className="relative z-30 flex h-(--masthead) shrink-0 items-center gap-3 border-b-(length:--rule-heavy) border-ink bg-paper px-4 sm:gap-6 sm:px-6"
    >
      <Link to="/" aria-label="NearbyNudge, campaigns" className="shrink-0 [--focus-offset:4px]">
        <BrandMark nameClassName="max-[360px]:hidden lg:max-[1440px]:hidden" />
      </Link>
      <nav aria-label="Main" className="hidden h-full lg:block">
        <ul className="flex h-full items-stretch gap-5">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname)
            return (
              <li key={item.to} className="flex">
                <Link
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center text-ui font-semibold whitespace-nowrap underline-offset-4 hover:underline",
                    active &&
                      "after:absolute after:inset-x-0 after:-bottom-(--rule-heavy) after:h-(--rule-heavy) after:bg-edge"
                  )}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      {/* Only the Options button gives way (its name and company truncate); the meters keep their size. */}
      <div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-5">
        {sending && (
          <Meter
            label="Sent today"
            value={sending.sent_today}
            max={sending.daily_cap}
            tone={atCap ? "warning" : "default"}
            size="sm"
            barClassName="w-12 flex-none max-sm:hidden xl:w-20"
            className="shrink-0 max-sm:[&>span:first-child]:sr-only"
          />
        )}
        {usage && (
          <Meter
            label={`Leads in ${usage.month_label.split(" ")[0]}`}
            value={usage.used}
            max={usage.limit}
            size="sm"
            tone={usage.used >= usage.limit ? "warning" : "default"}
            barClassName="w-12 flex-none"
            className="hidden shrink-0 xl:flex"
          />
        )}
        <OptionsMenu />
        <PhoneIndex pathname={pathname} />
      </div>
    </header>
  )
}

/** Under 1024px: a Menu button that opens the main navigation as an index page. */
function PhoneIndex({ pathname }: { pathname: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="outline" size="icon" className="lg:hidden" aria-label="Menu" onClick={() => setOpen(true)}>
        <MenuIcon aria-hidden="true" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="gap-0 p-0">
          <SheetHeader className="border-b-(length:--rule-heavy) border-ink px-5 pt-4 pb-3">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Go to a page</SheetDescription>
            <BrandMark />
          </SheetHeader>
          <nav aria-label="Main" className="overflow-y-auto px-5 py-4">
            <ul className="flex flex-col">
              {NAV_ITEMS.map((item) => {
                const active = item.match(pathname)
                return (
                  <li key={item.to} className="border-b border-hairline">
                    <Link
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex min-h-12 items-center text-head uppercase stretch-condensed underline-offset-4 hover:underline",
                        active && "text-edge"
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
