import * as React from "react"
import { getRouteApi, Link } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { Button, buttonVariants } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CalmError } from "@/components/CalmError"
import { EmailAddress } from "@/components/EmailAddress"
import { EmptyState } from "@/components/EmptyState"
import { Mark } from "@/components/Mark"
import { PageContainer } from "@/components/PageContainer"
import { PageHeader } from "@/components/PageHeader"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { StatusBadge } from "@/components/StatusBadge"
import { useAccount } from "@/hooks/use-account"
import { useAnnounce } from "@/hooks/use-announce"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useMediaQuery } from "@/hooks/use-media-query"
import { leadQuery, sentQuery } from "@/lib/api/queries"
import type { ReplyOutcome, SendingToday, SentItem } from "@/lib/api/types"
import { copyText } from "@/lib/clipboard"
import { api } from "@/lib/api"
import { formatDate, formatTime, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { viewOfStatus } from "@/features/review/search"
import { useLeadActions } from "@/features/review/use-lead-actions"

export type SentStatusFilter = "approved" | "sent" | "replied" | "all"

/** TanStack Router `validateSearch` for /sent. */
export function validateSentSearch(search: Record<string, unknown>): { status?: SentStatusFilter } {
  const value = search.status
  return {
    status: value === "approved" || value === "sent" || value === "replied" || value === "all" ? value : undefined,
  }
}

const route = getRouteApi("/app/sent")

const FILTERS: { value: SentStatusFilter; label: string }[] = [
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "all", label: "All" },
]

const matches = (filter: SentStatusFilter, item: SentItem) =>
  filter === "all" || item.status === filter

/** When the item last moved: replied, sent or approved. */
const when = (item: SentItem) => item.replied_at ?? item.sent_at ?? item.approved_at ?? item.updated_at

const EMPTY: Record<SentStatusFilter, { title: string; description: string }> = {
  approved: {
    title: "No approved emails waiting",
    description: "Approve drafts on a campaign's review desk. They wait here until you send them and mark them sent.",
  },
  sent: {
    title: "Nothing marked as sent yet",
    description: "After you send an approved email from your own account, mark it as sent so your numbers stay right.",
  },
  replied: {
    title: "No replies logged yet",
    description: "When a business replies, log it here. \"No thanks\" also adds them to your do-not-contact list.",
  },
  all: {
    title: "Nothing approved yet",
    description: "Approved, sent and replied emails from every campaign appear here.",
  },
}

// ---------------------------------------------------------------------------
// Row actions, shared by the table and the phone cards
// ---------------------------------------------------------------------------

interface RowState {
  busy: string | null
  message: string | null
  copied: boolean
}

interface SentActionsValue {
  state: Record<string, RowState | undefined>
  atCap: boolean
  markSent: (item: SentItem) => void
  replied: (item: SentItem, outcome: ReplyOutcome) => void
  copy: (item: SentItem) => void
  open: (item: SentItem) => void
}

const SentActionsContext = React.createContext<SentActionsValue | null>(null)

function useSentActions() {
  const value = React.useContext(SentActionsContext)
  if (!value) throw new Error("useSentActions must be used inside SentActionsContext.")
  return value
}

/** `roomy` gives phones 44px buttons; the table keeps them compact. */
function RowActions({ item, roomy = false }: { item: SentItem; roomy?: boolean }) {
  const actions = useSentActions()
  const state = actions.state[item.id]
  const busy = state?.busy ?? null
  const size = roomy ? "lg" : "sm"
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {item.status === "approved" && (
          <>
            {item.contact_email && (
              <Button size={size} variant="outline" onClick={() => actions.open(item)} disabled={busy !== null || actions.atCap}>
                Open in email app
              </Button>
            )}
            <Button size={size} variant="outline" onClick={() => actions.copy(item)} disabled={busy !== null || actions.atCap}>
              {state?.copied && <Mark name="check" />}
              {state?.copied ? "Copied" : "Copy"}
            </Button>
            <Button size={size} onClick={() => actions.markSent(item)} disabled={busy !== null || actions.atCap}>
              {busy === "sent" ? "Marking…" : "Mark as sent"}
            </Button>
          </>
        )}
        {item.status === "sent" && (
          <div
            role="group"
            aria-label={`Log a reply from ${item.name}`}
            className={cn("flex flex-wrap gap-x-1", roomy ? "items-center" : "flex-col items-start")}
          >
            <span className="mr-1 aside">Replied?</span>
            <span className={cn("flex flex-wrap items-center gap-x-1", !roomy && "-ml-1.5")}>
              <Button size={size} variant="link" className="px-1.5" onClick={() => actions.replied(item, "interested")} disabled={busy !== null}>
                Interested
              </Button>
              <Button size={size} variant="link" className="px-1.5" onClick={() => actions.replied(item, "no_thanks")} disabled={busy !== null}>
                No thanks
              </Button>
              <Button size={size} variant="link" className="px-1.5" onClick={() => actions.replied(item, "other")} disabled={busy !== null}>
                Other
              </Button>
            </span>
          </div>
        )}
        {item.status === "replied" && (
          <span className="aside">
            {item.reply_outcome === "no_thanks" ? "On your do-not-contact list" : "Reply logged"}
          </span>
        )}
      </div>
      {state?.message && (
        <p role="alert" className="flex items-start gap-1.5 text-meta font-semibold text-edge">
          <Mark name="asterisk" className="mt-0.5" />
          {state.message}
        </p>
      )}
    </div>
  )
}

function BusinessCell({ item }: { item: SentItem }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <Link
        to="/campaigns/$campaignId"
        params={{ campaignId: item.campaign_id }}
        search={{ lead: item.id, view: viewOfStatus(item.status) }}
        className="block truncate text-ui font-bold underline-offset-3 hover:underline"
      >
        {item.name}
      </Link>
      <p className="truncate aside">{item.campaign_name}</p>
    </div>
  )
}

function StatusCell({ item }: { item: SentItem }) {
  return (
    <div className="space-y-0.5">
      <StatusBadge status={item.status} date={item.sent_at} replyOutcome={item.reply_outcome} hideStep />
      <p className="aside tabular-nums">
        {item.status === "approved" && item.approved_at
          ? `Approved ${formatDate(item.approved_at)}`
          : item.status === "replied" && item.replied_at
            ? `${formatDate(item.replied_at)}`
            : item.sent_at
              ? `at ${formatTime(item.sent_at)}`
              : ""}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table (TanStack Table v9)
// ---------------------------------------------------------------------------

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
})
const helper = createColumnHelper<typeof features, SentItem>()
const columns = helper.columns([
  helper.accessor("name", {
    id: "business",
    header: "Business",
    sortFn: "alphanumeric",
    cell: (info) => <BusinessCell item={info.row.original} />,
  }),
  helper.accessor((row) => row.contact_email ?? "", {
    id: "to",
    header: "To",
    enableSorting: false,
    cell: (info) =>
      info.row.original.contact_email ? (
        <EmailAddress email={info.row.original.contact_email} className="text-ui" />
      ) : (
        <span className="aside">No email address</span>
      ),
  }),
  helper.accessor((row) => row.email_subject ?? "", {
    id: "subject",
    header: "Subject",
    enableSorting: false,
    cell: (info) => <span className="line-clamp-2 text-ui">{info.row.original.email_subject}</span>,
  }),
  helper.accessor((row) => new Date(when(row)).getTime(), {
    id: "date",
    header: "Status and date",
    cell: (info) => <StatusCell item={info.row.original} />,
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: (info) => <RowActions item={info.row.original} />,
  }),
])

const WIDTHS: Record<string, string> = {
  business: "w-[22%]",
  to: "w-[19%]",
  subject: "w-[20%]",
  date: "w-[15%]",
  actions: "w-[24%]",
}

function SentTable({ items, filter }: { items: SentItem[]; filter: SentStatusFilter }) {
  const table = useTable({
    features,
    columns,
    data: items,
    getRowId: (row) => row.id,
    initialState: { sorting: [{ id: "date", desc: true }] },
    enableSortingRemoval: false,
  })
  return (
    <div>
      <Table className="table-fixed">
        <caption className="sr-only">
          {FILTERS.find((f) => f.value === filter)?.label} emails, newest first
        </caption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                const canSort = header.column.getCanSort()
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    className={cn("h-12", WIDTHS[header.column.id])}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                      >
                        <table.FlexRender header={header} />
                        {sorted && (
                          <Mark name="pointer" className={cn("size-2.5", sorted === "asc" ? "-rotate-90" : "rotate-90")} />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-sent-id={row.id} className="align-top">
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className="py-4 align-top whitespace-normal">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SentCards({ items }: { items: SentItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id} data-sent-id={item.id} className="space-y-2.5 border-b border-hairline py-4">
          <div className="flex items-start justify-between gap-3">
            <BusinessCell item={item} />
            <StatusCell item={item} />
          </div>
          {item.email_subject && <p className="text-ui">{item.email_subject}</p>}
          <p className="aside">
            To {item.contact_email ? <EmailAddress email={item.contact_email} /> : "no published email address"}
          </p>
          <RowActions item={item} roomy />
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Sent (brief §3.1): every approved, sent and replied email across campaigns. */
export function SentPage() {
  useDocumentTitle("Sent")
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const wide = useMediaQuery("(min-width: 960px)")
  const { data: account } = useAccount()
  const query = useQuery(sentQuery("all"))
  const items = query.data?.items
  const sending: SendingToday | null = account?.sending ?? query.data?.sending ?? null
  const atCap = sending ? sending.sent_today >= sending.daily_cap : false
  const leadActions = useLeadActions()
  const [rowState, setRowState] = React.useState<Record<string, RowState | undefined>>({})

  const counts = React.useMemo(() => {
    const result: Record<SentStatusFilter, number> = { approved: 0, sent: 0, replied: 0, all: 0 }
    for (const item of items ?? []) {
      result.all += 1
      if (item.status === "approved") result.approved += 1
      if (item.status === "sent") result.sent += 1
      if (item.status === "replied") result.replied += 1
    }
    return result
  }, [items])
  const filter: SentStatusFilter = search.status ?? (counts.approved > 0 || !items ? "approved" : "all")
  const visible = React.useMemo(() => (items ?? []).filter((item) => matches(filter, item)), [items, filter])

  const patch = (id: string, next: Partial<RowState>) =>
    setRowState((current) => ({
      ...current,
      [id]: { busy: null, message: null, copied: false, ...current[id], ...next },
    }))

  const actions: SentActionsValue = {
    state: rowState,
    atCap,
    markSent: (item) => {
      patch(item.id, { busy: "sent", message: null })
      void leadActions.markSent(item, false).then((outcome) =>
        patch(item.id, { busy: null, message: outcome.ok ? null : (outcome.message ?? null) })
      )
    },
    replied: (item, outcome) => {
      patch(item.id, { busy: "replied", message: null })
      void leadActions.replied(item, outcome).then((result) =>
        patch(item.id, { busy: null, message: result.ok ? null : (result.message ?? null) })
      )
    },
    copy: (item) => {
      const text = queryClient.fetchQuery(leadQuery(item.id)).then((lead) => lead.copy_text ?? "")
      void copyText(text).then((ok) => {
        if (ok) {
          patch(item.id, { copied: true, message: null })
          announce("Copied. Paste it into a new email.")
          void api.logLeadEvent(item.id, { kind: "copied" }).catch(() => undefined)
          window.setTimeout(() => patch(item.id, { copied: false }), 2200)
        } else {
          patch(item.id, { message: "Your browser blocked copying. Open the lead and copy it from there." })
        }
      })
    },
    open: (item) => {
      void queryClient
        .fetchQuery(leadQuery(item.id))
        .then((lead) => {
          if (!lead.mailto_url) {
            patch(item.id, { message: "This lead has no email address to open. Copy the email instead." })
            return
          }
          void api.logLeadEvent(item.id, { kind: "opened_mailto" }).catch(() => undefined)
          window.location.href = lead.mailto_url
        })
        .catch(() => patch(item.id, { message: "We couldn't load this email. Try again." }))
    },
  }

  return (
    <PageContainer>
      <PageHeader
        title="Sent"
        description="Every approved email across your campaigns. NearbyNudge doesn't send: send each one from your own email account, then mark it here."
      />

      {atCap && sending && (
        <p
          role="status"
          className="mb-6 flex items-start gap-2.5 border border-ink border-t-(length:--rule-heavy) border-t-edge px-4 py-3 text-ui font-semibold"
        >
          <Mark name="lock" className="mt-1 text-edge" />
          <span>
            You've marked {sending.daily_cap} emails as sent today, the daily limit. Sending unlocks at midnight (
            {formatTime(sending.resets_at)}).
          </span>
        </p>
      )}

      <Tabs
        value={filter}
        onValueChange={(value) => void navigate({ search: { status: value as SentStatusFilter } })}
        className="gap-0"
      >
        <TabsList aria-label="Filter by status" className="w-full flex-nowrap gap-1 overflow-x-auto border-b-2 border-ink">
          {FILTERS.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="h-11 shrink-0 gap-2 px-2.5 sm:gap-2.5 sm:px-4">
              {item.label}
              <span className="numeral text-lead leading-none sm:text-head">{items ? counts[item.value] : ""}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {query.isError && !items ? (
        <CalmError title="We couldn't load your emails" error={query.error} onRetry={() => void query.refetch()} />
      ) : !items ? (
        <div className="space-y-6 pt-6" aria-busy="true">
          <span className="sr-only">Loading your emails</span>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-6" aria-hidden="true">
              <PlaceholderBar width="22%" />
              <PlaceholderBar width="18%" />
              <PlaceholderBar width="26%" />
              <PlaceholderBar width="10%" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div>
          <EmptyState
            {...EMPTY[filter]}
            action={
              <Link to="/" className={buttonVariants({ variant: "outline" })}>
                Go to campaigns
              </Link>
            }
          />
        </div>
      ) : (
        <SentActionsContext.Provider value={actions}>
          <p className="sr-only" aria-live="polite">
            {plural(visible.length, "email")} shown
          </p>
          {wide ? <SentTable items={visible} filter={filter} /> : <SentCards items={visible} />}
        </SentActionsContext.Provider>
      )}
    </PageContainer>
  )
}
