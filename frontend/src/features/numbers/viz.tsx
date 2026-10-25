import * as React from "react"
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

/*
 * Charts, figures and tables for Numbers and the admin console, set like the
 * statistics pages at the back of a city directory: one measure per chart with
 * its own scale (never two y-axes), square ink columns on a 1px ink baseline,
 * no gridlines, the current period in edge red, one direct label in condensed
 * numerals, a hover/focus tooltip, and a table view for every chart.
 */

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** "2026-10-19" as a local date (new Date("2026-10-19") would be UTC midnight). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** "Oct 19" for a "2026-10-19" day. */
export function shortDay(day: string): string {
  return parseDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** "Oct 19, 2026". */
export function longDay(day: string): string {
  return parseDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// ---------------------------------------------------------------------------
// Chart card with its table view
// ---------------------------------------------------------------------------

export type ChartView = "chart" | "table"

/** Two pressed-state words, Chart and Table; the pressed one is underlined in edge red. */
export function ViewToggle({
  view,
  onChange,
  label,
}: {
  view: ChartView
  onChange: (view: ChartView) => void
  /** What is shown, for the group's accessible name: "Found by week". */
  label: string
}) {
  const item =
    "inline-flex h-8 items-center px-0.5 text-ui font-semibold decoration-2 underline-offset-6 hover:underline aria-pressed:underline aria-pressed:decoration-edge"
  return (
    <div role="group" aria-label={`Show ${label} as`} className="inline-flex shrink-0 items-center gap-3">
      <button type="button" aria-pressed={view === "chart"} className={item} onClick={() => onChange("chart")}>
        Chart
      </button>
      <button type="button" aria-pressed={view === "table"} className={item} onClick={() => onChange("table")}>
        Table
      </button>
    </div>
  )
}

/**
 * A chart ruled off under a 2px ink rule, with a condensed title, one plain
 * sentence and the Chart and Table switch, so every value is readable without
 * the chart (WCAG 1.1.1, 1.4.1). No panel.
 */
export function ChartCard({
  title,
  description,
  chart,
  table,
  headingLevel = 3,
  footer,
  className,
  defaultView = "chart",
}: {
  title: string
  description?: React.ReactNode
  chart: React.ReactNode
  table: React.ReactNode
  headingLevel?: 2 | 3
  footer?: React.ReactNode
  className?: string
  defaultView?: ChartView
}) {
  const [view, setView] = React.useState<ChartView>(defaultView)
  const headingId = React.useId()
  const Heading = headingLevel === 2 ? "h2" : "h3"
  return (
    <section
      aria-labelledby={headingId}
      data-slot="chart-card"
      className={cn("flex min-w-0 flex-col border-t-2 border-ink pt-3", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <Heading
          id={headingId}
          className={cn("min-w-0", headingLevel === 2 ? "section-head" : "text-lead font-extrabold stretch-condensed")}
        >
          {title}
        </Heading>
        <ViewToggle view={view} onChange={setView} label={title} />
      </div>
      {description && <p className="mt-1 aside">{description}</p>}
      {/* mt-auto keeps plots level across a row of cards whose descriptions wrap differently. */}
      <div className="mt-auto min-w-0 pt-4">{view === "chart" ? chart : table}</div>
      {footer && <div className="mt-3">{footer}</div>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Column chart (one measure)
// ---------------------------------------------------------------------------

export interface ColumnDatum {
  /** Stable key, e.g. the week's Monday "2026-10-19". */
  key: string
  /** Axis text, e.g. "Oct 19". */
  tick: string
  /** Tooltip heading, e.g. "Week of Oct 19". */
  title: string
  value: number
}

function niceMax(max: number, min = 4): number {
  if (max <= min) return min
  const magnitude = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = Math.ceil(max / (step * magnitude)) * step * magnitude
    if (candidate >= max) return candidate
  }
  return max
}

function ColumnTooltip({
  active,
  payload,
  series,
  format,
}: {
  active?: boolean
  payload?: { payload?: ColumnDatum; value?: unknown }[]
  series: string
  format: (value: number) => string
}) {
  const item = payload?.[0]
  const datum = item?.payload
  if (!active || !datum) return null
  return (
    <div className="grid min-w-36 gap-0.5 border border-ink bg-paper px-3 py-2 text-ink shadow-overlay">
      <p className="aside">{datum.title}</p>
      <p className="flex items-baseline gap-2">
        <span className="numeral text-lead leading-none">{format(datum.value)}</span>
        <span className="text-meta">{series}</span>
      </p>
    </div>
  )
}

/**
 * Square ink columns for one measure over time, with its own integer (or
 * money) scale. The latest period is edge red and carries the only label; the
 * axis, tooltip and table carry the rest.
 */
export function ColumnChart({
  data,
  series,
  format = (value) => value.toLocaleString("en-US"),
  axisFormat,
  integer = true,
  height = 168,
  barSize = 20,
  labelLast = true,
  color = "var(--ink)",
  highlight = "var(--edge)",
  chartTitle,
  className,
}: {
  data: ColumnDatum[]
  /** The measure's name: "Found". Used in the tooltip and the chart's title. */
  series: string
  format?: (value: number) => string
  /** Shorter tick text for the y-axis (defaults to `format`). */
  axisFormat?: (value: number) => string
  integer?: boolean
  height?: number
  barSize?: number
  labelLast?: boolean
  color?: string
  /** Fill of the latest column, the current period. */
  highlight?: string
  /** Accessible title of the chart's SVG: "Found by week". */
  chartTitle?: string
  className?: string
}) {
  const config = React.useMemo<ChartConfig>(() => ({ value: { label: series, color } }), [series, color])
  const max = data.reduce((m, d) => Math.max(m, d.value), 0)
  const top = integer ? niceMax(max) : niceMax(max, 0.01) || 0.01
  const latest = data[data.length - 1]
  return (
    <ChartContainer
      config={config}
      className={cn("aspect-auto w-full [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-tint", className)}
      style={{ height }}
      initialDimension={{ width: 320, height }}
    >
      <BarChart
        data={data}
        margin={{ top: 22, right: 4, bottom: 0, left: 0 }}
        barCategoryGap="22%"
        title={chartTitle ?? series}
        desc={latest ? `Latest: ${format(latest.value)}` : undefined}
      >
        <XAxis
          dataKey="tick"
          tickLine={false}
          axisLine={{ stroke: "var(--ink)", strokeWidth: 1 }}
          tick={{ fill: "var(--ink)" }}
          tickMargin={6}
          minTickGap={10}
          interval="preserveStartEnd"
          fontSize={12}
        />
        <YAxis
          width={integer ? 28 : 44}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--ink)" }}
          allowDecimals={!integer}
          domain={[0, top]}
          tickCount={integer ? (top <= 4 ? top + 1 : 3) : 3}
          tickFormatter={(value: number) => (axisFormat ?? format)(value)}
          fontSize={12}
        />
        <ChartTooltip cursor content={<ColumnTooltip series={series} format={format} />} />
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          maxBarSize={barSize}
          isAnimationActive={false}
        >
          {data.map((datum, index) => (
            <Cell key={datum.key} fill={index === data.length - 1 ? highlight : color} />
          ))}
          {labelLast && (
            <LabelList
              dataKey="value"
              content={(props) => {
                // Recharts 3 only passes the drawn (non-zero) bars here, so
                // find the latest period by position, not by index.
                const { x, y, width, value, parentViewBox } = props as {
                  x?: number | string
                  y?: number | string
                  width?: number | string
                  value?: number | string
                  parentViewBox?: { x?: number; width?: number }
                }
                if (x === undefined || y === undefined || !parentViewBox?.width) return null
                const cx = Number(x) + Number(width ?? 0) / 2
                const band = parentViewBox.width / Math.max(1, data.length)
                const lastCenter = (parentViewBox.x ?? 0) + parentViewBox.width - band / 2
                if (Math.abs(cx - lastCenter) > band / 2) return null
                const text = format(Number(value ?? 0))
                // Keep the label inside the plot: right-align it when centering would clip it.
                const room = (parentViewBox.x ?? 0) + parentViewBox.width + 2 - cx
                const fits = text.length * 3.6 <= room
                return (
                  <text
                    x={fits ? cx : cx + room}
                    y={Number(y) - 6}
                    textAnchor={fits ? "middle" : "end"}
                    className="fill-ink text-ui font-extrabold"
                    style={{ fontVariantNumeric: "tabular-nums", fontStretch: "62.5%" }}
                  >
                    {text}
                  </text>
                )
              }}
            />
          )}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// ---------------------------------------------------------------------------
// Funnel (four ordinal steps)
// ---------------------------------------------------------------------------

export interface FunnelStep {
  key: string
  label: string
  value: number
}

/** "43% of found", or null when there is nothing to compare with. */
export function shareOf(value: number, of: number): string | null {
  if (of <= 0) return null
  return `${Math.round((value / of) * 100)}%`
}

/**
 * Found, Approved, Sent, Replied as four filled leader tracks, like the
 * meters: solid ink over a dotted rule. Each step carries its label and
 * value; the share of the first step sits beside it. The tracks are
 * decorative: the words carry the data.
 */
export function Funnel({ steps, className }: { steps: FunnelStep[]; className?: string }) {
  const first = steps[0]?.value ?? 0
  const max = Math.max(1, ...steps.map((step) => step.value))
  return (
    <ol className={cn("grid gap-5", className)} aria-label="Funnel steps">
      {steps.map((step, index) => {
        const width = (step.value / max) * 100
        const share = index > 0 ? shareOf(step.value, first) : null
        return (
          <li key={step.key} className="grid gap-2">
            <p className="flex items-baseline justify-between gap-3">
              <span className="flex items-baseline gap-2.5">
                <span className="text-ui font-bold">{step.label}</span>
                <span className="numeral text-head leading-none">{step.value.toLocaleString("en-US")}</span>
              </span>
              {share && (
                <span className="aside tabular-nums">
                  {share} of {steps[0].label.toLowerCase()}
                </span>
              )}
            </p>
            <span aria-hidden="true" className="relative block h-2 w-full">
              <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-b-2 border-dotted border-leader" />
              <span
                className="absolute inset-y-0 left-0 bg-ink"
                style={{ width: step.value > 0 ? `max(3px, ${width}%)` : 0 }}
              />
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/**
 * A figure set as a directory key line: the label, a dot leader, the value in
 * condensed numerals, then an optional comparison and a secondary line as
 * asides. Lives in a <dl>; the leader is the label's ::after, so the line
 * stays valid dt/dd markup. `wide` lays the asides out as columns on desktop.
 */
export function StatTile({
  label,
  value,
  detail,
  secondary,
  wide = false,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  detail?: React.ReactNode
  secondary?: React.ReactNode
  wide?: boolean
  className?: string
}) {
  return (
    <div
      data-slot="stat-tile"
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 border-b border-hairline py-3",
        wide && "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,19rem)_9rem] md:gap-x-0 md:py-4",
        className
      )}
    >
      <dt className="flex min-w-0 items-baseline gap-2 text-ui font-bold after:leader after:content-['']">{label}</dt>
      <dd className={cn("numeral text-head leading-none", wide && "text-title md:pl-2")}>{value}</dd>
      {detail && <dd className={cn("col-span-2 aside", wide && "md:col-span-1 md:pl-8")}>{detail}</dd>}
      {secondary && <dd className={cn("col-span-2 aside", wide && "md:col-span-1 md:pl-4 md:text-right")}>{secondary}</dd>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * A table that scrolls sideways inside its own focusable region on narrow
 * screens, so the page itself never scrolls horizontally (and keyboard
 * users can scroll it, WCAG 2.1.1).
 */
export function DataTable({
  label,
  caption,
  children,
  className,
}: {
  /** Accessible name of the scroll region and the table. */
  label: string
  /** Visible caption under the table (optional). */
  caption?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("focus-inset w-full min-w-0 overflow-x-auto", className)}
    >
      <table aria-label={label} className="w-full border-collapse text-left text-ui">
        {caption && <caption className="caption-bottom pt-2 text-left aside">{caption}</caption>}
        {children}
      </table>
    </div>
  )
}

export const th =
  "border-b-2 border-ink px-2.5 pt-1 pb-2 align-bottom text-ui font-extrabold whitespace-nowrap stretch-condensed first:pl-0 last:pr-0"
export const thNum = cn(th, "text-right")
export const td = "border-b border-hairline px-2.5 py-2.5 align-top first:pl-0 last:pr-0"
export const tdNum = cn(td, "text-right whitespace-nowrap tabular-nums")
