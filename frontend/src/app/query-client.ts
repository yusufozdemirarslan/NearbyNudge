import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { isApiError } from "@/lib/api/client"

let onSignedOut: (() => void) | null = null

/** Set by the router: what to do when a request finds the session gone (it ran out, or another tab signed out). */
export function setSignedOutHandler(handler: () => void) {
  onSignedOut = handler
}

function signedOut(error: unknown) {
  if (isApiError(error, "auth_required")) onSignedOut?.()
}

/** One QueryClient for the app. Errors are shown in place, never only in toasts. */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: signedOut }),
  mutationCache: new MutationCache({ onError: signedOut }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Don't retry answers that won't change on retry.
        if (isApiError(error) && [401, 403, 404, 409, 422].includes(error.status)) return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: false,
    },
  },
})
