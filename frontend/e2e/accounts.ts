import { expect, type Page } from "@playwright/test"

/*
 * Helpers for the specs that run against the real backend started by
 * backend/scripts/e2e_server.py (fixture sites and the fake AI) with
 * E2E_BASE_URL set, e.g.
 *
 *   E2E_BASE_URL=http://localhost:8100 npx playwright test
 *
 * The app has no sign-in: everyone uses one workspace. The test server also
 * offers POST /api/dev/workspace, which gives a test its own isolated
 * workspace (a cookie), so tests can run in parallel without sharing
 * campaigns, lists or preferences.
 */

/** A unique workspace key, e.g. "dnc-lq3k9a-7f2c". */
export function uniqueKey(tag: string): string {
  const stamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 6)
  return `${tag}-${stamp}-${random}`
}

/** Reads (and if needed obtains) the double-submit CSRF cookie. */
export async function csrfToken(page: Page): Promise<string> {
  const existing = (await page.context().cookies()).find((cookie) => cookie.name === "nn_csrf")?.value
  if (existing) return existing
  await page.request.get("/api/me")
  return (await page.context().cookies()).find((cookie) => cookie.name === "nn_csrf")?.value ?? ""
}

/** Sends a JSON request with the CSRF header, through the page's cookies. */
export async function apiRequest<T = unknown>(
  page: Page,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  data?: unknown
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {}
  if (method !== "GET") headers["X-CSRF-Token"] = await csrfToken(page)
  const response = await page.request.fetch(path, { method, data, headers })
  const text = await response.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status(), body: body as T }
}

export interface TestWorkspace {
  id: string
  name: string
  onboarded: boolean
  created_at: string
}

/**
 * Switches the page to its own workspace through POST /api/dev/workspace
 * (test servers only). A new key (the default) gives a fresh workspace with
 * a complete sender profile, or none with `onboarded: false`; the same key
 * returns the same workspace.
 */
export async function devWorkspace(
  page: Page,
  options: { key?: string; tag?: string; onboarded?: boolean; name?: string } = {}
): Promise<TestWorkspace> {
  const key = options.key ?? uniqueKey(options.tag ?? "workspace")
  const { status, body } = await apiRequest<{ user: TestWorkspace }>(page, "POST", "/api/dev/workspace", {
    key,
    onboarded: options.onboarded ?? true,
    name: options.name,
  })
  expect(status, "POST /api/dev/workspace needs the test server (backend/scripts/e2e_server.py)").toBe(200)
  return body.user
}

/** Waits until the app's first screen has rendered (any h1). */
export async function waitForApp(page: Page) {
  await expect(page.locator("h1").first()).toBeVisible()
}
