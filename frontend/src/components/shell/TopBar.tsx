import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Meter } from "@/components/Meter"
import { useAccount } from "@/hooks/use-account"
import { cn } from "@/lib/utils"

/**
 * The bar above every app page: the sidebar toggle, an optional page
 * context slot, "Sent today 7 of 20" and the monthly usage meter.
 */
export function TopBar({ children, className }: { children?: React.ReactNode; className?: string }) {
  const { data: account } = useAccount()
  const sending = account?.sending
  const usage = account?.usage
  const atCap = sending ? sending.sent_today >= sending.daily_cap : false
  return (
    <div
      data-slot="top-bar"
      className={cn("flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4", className)}
    >
      <SidebarTrigger className="-ml-1" aria-label="Show or hide navigation" />
      <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-center" />
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <div className="flex shrink-0 items-center gap-5">
        {sending && (
          <Meter
              label="Sent today"
              value={sending.sent_today}
              max={sending.daily_cap}
              tone={atCap ? "warning" : "default"}
              size="sm"
              barClassName="w-16 flex-none sm:w-24"
              className="max-sm:[&>span:first-child]:sr-only"
            />
        )}
        {usage && (
          <Meter
            label={`Leads in ${usage.month_label.split(" ")[0]}`}
            value={usage.used}
            max={usage.limit}
            size="sm"
            tone={usage.used >= usage.limit ? "warning" : "default"}
            barClassName="w-16 flex-none"
            className="hidden lg:flex"
          />
        )}
      </div>
    </div>
  )
}
