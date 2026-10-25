import * as React from "react"
import { BarChart3Icon, TableIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

/*
 * Charts, figures and tables for Numbers and the admin console, following the
 * dataviz method: one measure per chart with its own scale (never two y-axes),
 * thin columns (<= 24 px) with 4 px rounded data-ends, hairline grid, text in
 * text tokens, selective labels, a hover/focus tooltip, and a table view for
 * every chart. Colors are the brief's tokens: --chart-3 for single series,
 * --chart-1..4 as the validated ordinal ramp for the funnel.
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

/** Two pressed-state buttons: Chart | Table. */
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
    "inline-flex h-7 items-center gap-1 rounded-md px-2 text-meta font-medium text-ink-secondary transition-colors hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-[0_0_0_1px_var(--border)]"
  return (
    <div role="group" aria-label={`Show ${label} as`} className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
      <button type="button" aria-pressed={view === "chart"} className={item} onClick={() => onChange("chart")}>
        <BarChart3Icon aria-hidden="true" className="size-3.5" />
        Chart
      </button>
      <button type="button" aria-pressed={view === "table"} className={item} onClick={() => onChange("table")}>
        <TableIcon aria-hidden="true" className="size-3.5" />
        Table
      </button>
    </div>
  )
}

/**
 * A chart in a quiet panel with a title, one plain sentence and a Chart |
 * Table switch, so every value is readable without the chart (WCAG 1.1.1,
 * 1.4.1).
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
      className={cn("flex min-w-0 flex-col rounded-xl border bg-card p-4 sm:p-5", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <Heading
          id={headingId}
          className={cn("min-w-0 font-semibold text-foreground", headingLevel === 2 ? "text-pane-title" : "text-ui")}
        >
          {title}
        </Heading>
        <ViewToggle view={view} onChange={setView} label={title} />
      </div>
      {description && <p className="mt-1 text-meta text-ink-secondary">{description}</p>}
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
    <div className="grid min-w-36 gap-1 rounded-lg border bg-popover px-3 py-2 shadow-popover">
      <p className="text-meta text-ink-secondary">{datum.title}</p>
      <p className="flex items-center gap-2">
        <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-[var(--color-value)]" />
        <span className="text-ui font-semibold text-foreground tabular-nums">{format(datum.value)}</span>
        <span className="text-meta text-muted-foreground">{series}</span>
      </p>
    </div>
  )
}

/**
 * Columns for one measure over time, with its own integer (or money) scale.
 * Labels only the latest column; the axis, tooltip and table carry the rest.
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
  color = "var(--chart-3)",
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
      className={cn("aspect-auto w-full [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-[var(--muted)]", className)}
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
        <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
        <XAxis
          dataKey="tick"
          tickLine={false}
          axisLine={{ stroke: "color-mix(in srgb, var(--foreground) 24%, transparent)" }}
          tickMargin={6}
          minTickGap={10}
          interval="preserveStartEnd"
          fontSize={12}
        />
        <YAxis
          width={integer ? 28 : 44}
          tickLine={false}
          axisLine={false}
          allowDecimals={!integer}
          domain={[0, top]}
          tickCount={integer ? (top <= 4 ? top + 1 : 5) : 3}
          tickFormatter={(value: number) => (axisFormat ?? format)(value)}
          fontSize={12}
        />
        <ChartTooltip cursor content={<ColumnTooltip series={series} format={format} />} />
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          radius={[4, 4, 0, 0]}
          maxBarSize={barSize}
          isAnimationActive={false}
        >
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
                    className="fill-foreground text-meta font-semibold"
                    style={{ fontVariantNumeric: "tabular-nums" }}
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

const FUNNEL_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"]

/** "43% of found", or null when there is nothing to compare with. */
export function shareOf(value: number, of: number): string | null {
  if (of <= 0) return null
  return `${Math.round((value / of) * 100)}%`
}

/**
 * Found → Approved → Sent → Replied in four teal steps (the ordinal ramp,
 * lightest first). Each bar carries its label and value; the share of the
 * first step sits beside it. Bars are decorative: the words carry the data.
 */
export function Funnel({ steps, className }: { steps: FunnelStep[]; className?: string }) {
  const first = steps[0]?.value ?? 0
  const max = Math.max(1, ...steps.map((step) => step.value))
  return (
    <ol className={cn("grid gap-3.5", className)} aria-label="Funnel steps">
      {steps.map((step, index) => {
        const width = (step.value / max) * 100
        const share = index > 0 ? shareOf(step.value, first) : null
        return (
          <li key={step.key} className="grid gap-1.5">
            <p className="flex items-baseline justify-between gap-3">
              <span className="flex items-baseline gap-2">
                <span className="text-ui font-medium text-foreground">{step.label}</span>
                <span className="text-ui font-semibold text-foreground tabular-nums">
                  {step.value.toLocaleString("en-US")}
                </span>
              </span>
              {share && (
                <span className="text-meta text-ink-secondary tabular-nums">
                  {share} of {steps[0].label.toLowerCase()}
                </span>
              )}
            </p>
            <span aria-hidden="true" className="block h-5 w-full">
              <span
                className="block h-full rounded-r-[4px]"
                style={{
                  width: step.value > 0 ? `max(4px, ${width}%)` : 0,
                  background: FUNNEL_COLORS[index % FUNNEL_COLORS.length],
                }}
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
 * A headline number: label, value (proportional figures), an optional
 * comparison line and a secondary line.
 */
export function StatTile({
  label,
  value,
  detail,
  secondary,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  detail?: React.ReactNode
  secondary?: React.ReactNode
  className?: string
}) {
  return (
    <div data-slot="stat-tile" className={cn("flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4", className)}>
      <dt className="text-ui text-ink-secondary">{label}</dt>
      <dd className="text-headline font-semibold text-foreground">{value}</dd>
      {detail && <dd className="text-meta text-ink-secondary">{detail}</dd>}
      {secondary && <dd className="text-meta text-muted-foreground">{secondary}</dd>}
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
      className={cn("focus-inset w-full min-w-0 overflow-x-auto rounded-lg", className)}
    >
      <table aria-label={label} className="w-full border-collapse text-left text-list">
        {caption && <caption className="caption-bottom pt-2 text-left text-meta text-muted-foreground">{caption}</caption>}
        {children}
      </table>
    </div>
  )
}

export const th = "border-b px-2.5 py-2 text-meta font-medium whitespace-nowrap text-ink-secondary first:pl-0 last:pr-0"
export const thNum = cn(th, "text-right")
export const td = "border-b px-2.5 py-2 align-top text-foreground first:pl-0 last:pr-0"
export const tdNum = cn(td, "text-right whitespace-nowrap tabular-nums")
