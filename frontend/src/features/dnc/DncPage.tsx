import * as React from "react"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  CircleMinusIcon,
  DownloadIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from "lucide-react"
import { CalmError } from "@/components/CalmError"
import { EmptyState } from "@/components/EmptyState"
import { PageContainer } from "@/components/PageContainer"
import { PageHeader } from "@/components/PageHeader"
import { PlaceholderBar } from "@/components/PlaceholderBar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAnnounce } from "@/hooks/use-announce"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useShortcuts } from "@/hooks/use-shortcuts"
import { api } from "@/lib/api"
import { dncQuery, qk } from "@/lib/api/queries"
import type { DncEntry } from "@/lib/api/types"
import { plural } from "@/lib/format"
import { dismissToast, notify } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { downloadBlob } from "@/features/settings/form-kit"
import { AddEntryForm } from "./AddEntryForm"
import {
  EntryRow,
  RemovedRow,
  type ListRow,
  type RemovedEntry,
} from "./DncList"
import {
  addToCaches,
  byNewest,
  entryLabel,
  matchesQuery,
  removeFromCaches,
} from "./entries"

/** `value`, updated only after it has stopped changing for `delay` ms. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

type FocusTarget = { kind: "row" | "undo"; id: string } | null

/**
 * Do not contact (/dnc, PRD DB3): the list NearbyNudge checks before drafting
 * every email. Add, search, remove with Undo (on the row and in a message)
 * and export as CSV.
 */
export function DncPage() {
  useDocumentTitle("Do not contact")
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const [search, setSearch] = React.useState("")
  const q = useDebouncedValue(search.trim(), 250)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const all = useQuery(dncQuery(""))
  const results = useQuery({
    ...dncQuery(q),
    placeholderData: keepPreviousData,
  })

  const [removed, setRemoved] = React.useState<Map<string, RemovedEntry>>(
    () => new Map()
  )
  const removedRef = React.useRef(removed)
  React.useLayoutEffect(() => {
    removedRef.current = removed
  })
  // Rows just added or restored get a soft tint that fades once (not again on re-render).
  const [freshIds, setFreshIds] = React.useState<Set<string>>(() => new Set())
  const markFresh = React.useCallback((id: string) => {
    setFreshIds((previous) => new Set(previous).add(id))
    window.setTimeout(() => {
      setFreshIds((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }, 1500)
  }, [])
  const [focusTarget, setFocusTarget] = React.useState<FocusTarget>(null)
  const clearFocusTarget = React.useCallback(() => setFocusTarget(null), [])

  useShortcuts(
    {
      "/": {
        description: "Search the list",
        handler: () => searchRef.current?.focus(),
      },
    },
    { group: "Do not contact" }
  )

  const patchRemoved = React.useCallback(
    (id: string, patch: Partial<RemovedEntry> | null) => {
      setRemoved((previous) => {
        const next = new Map(previous)
        const current = next.get(id)
        if (patch === null) next.delete(id)
        else if (current) next.set(id, { ...current, ...patch })
        return next
      })
    },
    []
  )

  /** Undo a removal: add the same entry back (POST /api/dnc). */
  const restore = React.useCallback(
    async (id: string) => {
      const current = removedRef.current.get(id)
      if (!current || current.restoring) return
      patchRemoved(id, { restoring: true, error: null })
      const { entry } = current
      try {
        const created = await api.createDnc({
          business_name: entry.business_name ?? undefined,
          domain: entry.domain ?? undefined,
          email: entry.email ?? undefined,
          reason: entry.reason ?? undefined,
        })
        if (current.toastId) dismissToast(current.toastId)
        addToCaches(queryClient, created)
        void queryClient.invalidateQueries({ queryKey: qk.dncAll() })
        patchRemoved(id, null)
        markFresh(created.id)
        setFocusTarget({ kind: "row", id: created.id })
        announce(`Restored ${entryLabel(created)} to your Do not contact list`)
      } catch {
        patchRemoved(id, {
          restoring: false,
          error:
            "We couldn't put this back. Check your connection and choose Undo again.",
        })
      }
    },
    [announce, markFresh, patchRemoved, queryClient]
  )
  const restoreRef = React.useRef(restore)
  React.useLayoutEffect(() => {
    restoreRef.current = restore
  })

  const handleRemoved = React.useCallback(
    (entry: DncEntry) => {
      removeFromCaches(queryClient, entry.id)
      void queryClient.invalidateQueries({ queryKey: qk.dncAll() })
      const toastId = notify({
        title: `Removed ${entryLabel(entry)}`,
        description: "NearbyNudge can draft emails to it again.",
        action: {
          label: "Undo",
          onClick: () => void restoreRef.current(entry.id),
        },
      })
      setRemoved((previous) =>
        new Map(previous).set(entry.id, {
          entry,
          restoring: false,
          error: null,
          toastId,
        })
      )
      setFocusTarget({ kind: "undo", id: entry.id })
    },
    [queryClient]
  )

  const exportCsv = useMutation({
    mutationFn: () => api.downloadDncCsv(),
    onSuccess: (blob) => {
      downloadBlob(blob, "do-not-contact.csv")
      announce("Downloaded do-not-contact.csv")
    },
  })

  // Entries from the server, with this visit's removed ones kept in their place.
  const rows = React.useMemo<ListRow[]>(() => {
    const data = results.data ?? []
    const ids = new Set(data.map((entry) => entry.id))
    const list: ListRow[] = data.map((entry) => {
      const gone = removed.get(entry.id)
      return gone
        ? { kind: "removed", removed: gone }
        : { kind: "entry", entry }
    })
    for (const gone of removed.values()) {
      if (!ids.has(gone.entry.id) && matchesQuery(gone.entry, q))
        list.push({ kind: "removed", removed: gone })
    }
    const entryOf = (row: ListRow) =>
      row.kind === "entry" ? row.entry : row.removed.entry
    return list.sort((a, b) => byNewest(entryOf(a), entryOf(b)))
  }, [results.data, removed, q])

  // Say how many entries match once a search settles.
  const lastAnnounced = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!q) {
      lastAnnounced.current = null
      return
    }
    if (
      results.isPlaceholderData ||
      !results.data ||
      lastAnnounced.current === q
    )
      return
    lastAnnounced.current = q
    announce(`${plural(results.data.length, "match", "matches")} for ${q}`)
  }, [announce, q, results.data, results.isPlaceholderData])

  const total = all.data?.length ?? null
  const searching = q.length > 0
  const matchCount = results.data?.length ?? 0
  const countLine = searching
    ? `${plural(matchCount, "match", "matches")} for “${q}”`
    : total === null
      ? "Loading your list…"
      : total === 0
        ? "Nothing on your list yet"
        : `${plural(total, "entry", "entries")} on your list`

  let body: React.ReactNode
  if (results.isPending) {
    body = (
      <ul aria-hidden="true" className="divide-y">
        {[0, 1, 2].map((index) => (
          <li key={index} className="flex items-center gap-6 px-4 py-4 sm:px-5">
            <div className="flex flex-1 flex-col gap-2">
              <PlaceholderBar width={index === 1 ? 140 : 190} />
              <PlaceholderBar width={index === 1 ? 220 : 160} />
            </div>
            <PlaceholderBar width={72} height={32} />
          </li>
        ))}
      </ul>
    )
  } else if (results.isError && !results.data) {
    body = (
      <div className="p-4 sm:p-5">
        <CalmError
          size="inline"
          title="We couldn't load your Do not contact list"
          error={results.error}
          onRetry={() => void results.refetch()}
        />
      </div>
    )
  } else if (rows.length === 0) {
    body = searching ? (
      <EmptyState
        size="inline"
        icon={SearchXIcon}
        title={`Nothing matches “${q}”`}
        description="Search looks at business names, websites and email addresses."
        action={
          <Button variant="outline" size="sm" onClick={() => setSearch("")}>
            Clear search
          </Button>
        }
      />
    ) : (
      <EmptyState
        size="inline"
        icon={CircleMinusIcon}
        title="Your list is empty"
        description="When you mark a business Do not contact on the review desk, or log a “no thanks” reply, it appears here. You can also add one above."
      />
    )
  } else {
    body = (
      <ul
        aria-labelledby="dnc-list-title"
        aria-busy={results.isPlaceholderData || undefined}
        className={cn(
          "divide-y transition-opacity",
          results.isPlaceholderData && "opacity-60"
        )}
      >
        {rows.map((row) =>
          row.kind === "entry" ? (
            <EntryRow
              key={row.entry.id}
              entry={row.entry}
              fresh={freshIds.has(row.entry.id)}
              focusOnMount={
                focusTarget?.kind === "row" && focusTarget.id === row.entry.id
              }
              onFocused={clearFocusTarget}
              onRemoved={handleRemoved}
            />
          ) : (
            <RemovedRow
              key={`removed-${row.removed.entry.id}`}
              removed={row.removed}
              focusOnMount={
                focusTarget?.kind === "undo" &&
                focusTarget.id === row.removed.entry.id
              }
              onFocused={clearFocusTarget}
              onUndo={() => void restore(row.removed.entry.id)}
            />
          )
        )}
      </ul>
    )
  }

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Do not contact"
        description="NearbyNudge checks this list before drafting every email."
        actions={
          <Button
            variant="outline"
            className="max-sm:h-11"
            disabled={exportCsv.isPending}
            onClick={() => exportCsv.mutate()}
          >
            <DownloadIcon aria-hidden="true" />
            {exportCsv.isPending ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />
      {exportCsv.isError && (
        <CalmError
          size="inline"
          className="mb-6"
          title="We couldn't export your list"
          error={exportCsv.error}
          onRetry={() => exportCsv.mutate()}
        />
      )}
      <div className="flex flex-col gap-6">
        <AddEntryForm onAdded={(entry) => markFresh(entry.id)} />

        <section
          aria-labelledby="dnc-list-title"
          className="overflow-hidden rounded-xl border bg-card"
        >
          <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0 space-y-0.5">
              <h2
                id="dnc-list-title"
                className="text-pane-title font-semibold text-foreground"
              >
                On your list
              </h2>
              <p id="dnc-count" className="text-ui text-ink-secondary">
                {countLine}
              </p>
            </div>
            <div className="relative w-full sm:w-80">
              <label htmlFor="dnc-search" className="sr-only">
                Search the list
              </label>
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="dnc-search"
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && search) {
                    event.preventDefault()
                    setSearch("")
                  }
                }}
                placeholder="Search names, websites and emails"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="dnc-count"
                className="h-9 pr-9 pl-8 text-base md:text-ui [&::-webkit-search-cancel-button]:appearance-none"
              />
              {search && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-0.5 -translate-y-1/2"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch("")
                    searchRef.current?.focus()
                  }}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
          {body}
        </section>
      </div>
    </PageContainer>
  )
}
