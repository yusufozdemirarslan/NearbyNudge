import * as React from "react"
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { accountQuery, meQuery, qk, statusQuery } from "@/lib/api/queries"
import type { Account, Preferences, SendingToday } from "@/lib/api/types"

/** Defaults used until the account loads. */
export const DEFAULT_PREFERENCES: Preferences = {
  shortcuts_enabled: true,
  webmail_mode: false,
  theme: "system",
  compact_rows: false,
  live_updates: true,
}

/** The workspace's account: sender profile, preferences, usage and the sending meter. */
export function useAccount() {
  return useQuery(accountQuery())
}

/** The workspace from GET /api/me (sender name, onboarded), or null while it loads. */
export function useCurrentUser() {
  const { data } = useQuery(meQuery())
  return data?.user ?? null
}

/** Current preferences, falling back to the defaults while loading. */
export function usePreferences(): Preferences {
  const { data } = useAccount()
  return data?.preferences ?? DEFAULT_PREFERENCES
}

/**
 * Returns `update(patch)`: merges the patch into the saved preferences and
 * sends the whole object (PUT /api/account/preferences). The cache updates
 * at once and rolls back if the request fails.
 */
export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (next: Preferences) => api.updatePreferences(next),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: qk.account() })
      const previous = queryClient.getQueryData<Account>(qk.account())
      if (previous) queryClient.setQueryData<Account>(qk.account(), { ...previous, preferences: next })
      return { previous }
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(qk.account(), context.previous)
    },
    onSuccess: (account) => queryClient.setQueryData(qk.account(), account),
  })
  return React.useCallback(
    (patch: Partial<Preferences>) => {
      const current = queryClient.getQueryData<Account>(qk.account())?.preferences ?? DEFAULT_PREFERENCES
      return mutation.mutateAsync({ ...current, ...patch })
    },
    [mutation, queryClient]
  )
}

/** Writes the latest "Sent today" numbers (from an action result) into the cache. */
export function setSendingInCache(queryClient: QueryClient, sending: SendingToday) {
  queryClient.setQueryData<Account>(qk.account(), (account) =>
    account ? { ...account, sending } : account
  )
}

/** Today's sending meter, or null while the account loads. */
export function useSending(): SendingToday | null {
  const { data } = useAccount()
  return data?.sending ?? null
}

/**
 * The AI's display name from GET /api/status (never hard-coded), with
 * helpers for "Claude's plan" / "Claude's judgment". While the status loads
 * the labels fall back to "AI plan" and "AI judgment".
 */
export function useAiName() {
  const { data } = useQuery(statusQuery())
  const name = data?.ai_name?.trim() || null
  const label = React.useCallback(
    (thing: "plan" | "judgment") => (name ? `${name}'s ${thing}` : `AI ${thing}`),
    [name]
  )
  return { name, model: data?.ai_model ?? null, label }
}
