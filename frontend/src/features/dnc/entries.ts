import type { QueryClient } from "@tanstack/react-query"
import { qk } from "@/lib/api/queries"
import type { DncEntry } from "@/lib/api/types"

/** Who put an entry on the list, in the words the list shows. */
export const SOURCE_LABEL: Record<DncEntry["source"], string> = {
  user: "You",
  lead: "From a lead",
  reply: "Replied no thanks",
}

/** The entry's main name: the business, else its website, else its email. */
export function entryLabel(
  entry: Pick<DncEntry, "business_name" | "domain" | "email">
): string {
  return entry.business_name ?? entry.domain ?? entry.email ?? "This entry"
}

/** Mirrors the server's search (GET /api/dnc?q=): name, domain or email contains q. */
export function matchesQuery(entry: DncEntry, q: string): boolean {
  const query = q.trim().toLowerCase()
  if (!query) return true
  return [entry.business_name, entry.domain, entry.email].some((value) =>
    value?.toLowerCase().includes(query)
  )
}

/** Newest first, like the server. */
export function byNewest(a: { created_at: string }, b: { created_at: string }) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

/** The search text a cached ["dnc", q] query was made with. */
function queryText(key: readonly unknown[]): string {
  return typeof key[1] === "string" ? key[1] : ""
}

/** Puts a new entry into every cached list it belongs in (before the refetch lands). */
export function addToCaches(queryClient: QueryClient, entry: DncEntry) {
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: qk.dncAll() })) {
    if (!matchesQuery(entry, queryText(query.queryKey))) continue
    queryClient.setQueryData<DncEntry[]>(query.queryKey, (old) =>
      old
        ? [entry, ...old.filter((e) => e.id !== entry.id)].sort(byNewest)
        : old
    )
  }
}

/** Takes an entry out of every cached list. */
export function removeFromCaches(queryClient: QueryClient, id: string) {
  queryClient.setQueriesData<DncEntry[]>({ queryKey: qk.dncAll() }, (old) =>
    old?.filter((e) => e.id !== id)
  )
}
