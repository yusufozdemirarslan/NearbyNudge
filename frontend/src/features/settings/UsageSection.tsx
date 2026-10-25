import { Meter } from "@/components/Meter"
import type { Account } from "@/lib/api/types"
import { formatNumber, formatTime, plural } from "@/lib/format"
import { Section } from "./form-kit"

/** This month's lead allowance and today's sending count. */
export function UsageSection({ account }: { account: Account }) {
  const { usage, sending } = account
  const remaining = Math.max(0, usage.limit - usage.used)
  const atLimit = usage.used >= usage.limit
  const atCap = sending.sent_today >= sending.daily_cap
  return (
    <Section
      id="usage"
      title="Usage"
      description={`The pilot is free and includes ${formatNumber(usage.limit)} drafted leads a month. Leads that couldn't be finished, and businesses that were replaced, don't count.`}
    >
      <div className="flex max-w-xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Meter
            label={`Leads drafted in ${usage.month_label}`}
            value={usage.used}
            max={usage.limit}
            tone={atLimit ? "warning" : "default"}
          />
          <p className="text-ui text-ink-secondary">
            {atLimit
              ? "You've used this month's allowance. It resets on the first of next month."
              : `${plural(remaining, "lead")} left this month. The count resets on the first of next month.`}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Meter
            label="Sent today"
            value={sending.sent_today}
            max={sending.daily_cap}
            tone={atCap ? "warning" : "default"}
          />
          <p className="text-ui text-ink-secondary">
            NearbyNudge doesn't send email. This counts the emails you marked as sent, up to{" "}
            {formatNumber(sending.daily_cap)} a day; it resets at {formatTime(sending.resets_at)}.
          </p>
        </div>
      </div>
    </Section>
  )
}
