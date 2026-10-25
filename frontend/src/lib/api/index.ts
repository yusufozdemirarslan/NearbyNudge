import type { Api } from "./api"
import { httpApi } from "./endpoints"

/*
 * The active API adapter.
 *
 * `import.meta.env.VITE_MOCK_API` is replaced at build time with the literal
 * "1" (npm run dev:mock) or "0" (everything else, including production), so
 * the branch below and the whole mock module are removed from production
 * bundles. `npm run build` verifies no mock data reaches dist/.
 */
let active: Api = httpApi
if (import.meta.env.VITE_MOCK_API === "1") {
  const { mockApi } = await import("./mock")
  active = mockApi
}

/** Every endpoint in the API contract as a typed function. */
export const api: Api = active

/** True while running against the in-memory mock adapter. */
export const usingMockApi = import.meta.env.VITE_MOCK_API === "1"

export type { Api, CampaignStreamHandlers, SentFilter } from "./api"
export { ApiError, isAbortError, isApiError, readCsrfToken } from "./client"
export type * from "./types"
