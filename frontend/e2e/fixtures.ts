import AxeBuilder from "@axe-core/playwright"
import { test as base, expect, type Page } from "@playwright/test"

/** True when the tests run against a real backend (E2E_BASE_URL is set). */
export const usingRealBackend = Boolean(process.env.E2E_BASE_URL)

/**
 * The workspace key for real-backend runs (POST /api/dev/workspace on the
 * test server). One fresh workspace per worker process, so preferences and
 * campaigns from earlier runs never leak in.
 */
export const E2E_WORKSPACE = process.env.E2E_WORKSPACE ?? `e2e-${process.pid}-${Date.now().toString(36)}`

/** The mock adapter's live sample campaign ("Dentists within 5 mi of Arlington, VA"). */
export const LIVE_CAMPAIGN = "/campaigns/c1"

interface Fixtures {
  /** On a real backend, uses this worker's own workspace; the mock has one built in. */
  workspace: void
}

export const test = base.extend<Fixtures>({
  workspace: [
    async ({ page }, use) => {
      if (usingRealBackend) {
        await page.request.get("/api/me")
        const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "nn_csrf")?.value
        const response = await page.request.post("/api/dev/workspace", {
          data: { key: E2E_WORKSPACE },
          headers: csrf ? { "X-CSRF-Token": csrf } : {},
        })
        expect(response.ok(), "POST /api/dev/workspace needs the test server (backend/scripts/e2e_server.py)").toBeTruthy()
      }
      await use()
    },
    { auto: true },
  ],
})

export { expect }

/** Sets mock controls (see src/lib/api/mock/index.ts) before the app loads. */
export async function mockSettings(page: Page, settings: Record<string, string>) {
  await page.addInitScript((values) => {
    for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value)
  }, settings)
}

/** Runs axe with the WCAG 2.0–2.2 A/AA rules and fails on any violation. */
export async function expectNoAxeViolations(page: Page, context?: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze()
  const summary = results.violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n${v.nodes
          .slice(0, 5)
          .map((n) => `    ${n.target.join(" ")}\n      ${n.failureSummary?.replace(/\n/g, "\n      ")}`)
          .join("\n")}`
    )
    .join("\n\n")
  expect(results.violations, `${context ?? page.url()}\n${summary}`).toEqual([])
}
