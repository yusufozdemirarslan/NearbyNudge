import { QueryClient } from "@tanstack/react-query"
import { isApiError } from "@/lib/api/client"

/** One QueryClient for the app. Errors are shown in place, never only in toasts. */
export const queryClient = new QueryClient({
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
