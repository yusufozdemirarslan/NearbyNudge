import { defineConfig, devices } from "@playwright/test"

/*
 * End-to-end tests.
 *
 * By default they run against the in-memory mock adapter: Playwright starts
 * `npm run dev:mock` on E2E_PORT (5199) and every test gets a fresh page, so
 * the mock data starts from the same state each time.
 *
 * To run against a real backend (backend/scripts/e2e_server.py: fixture sites
 * and the fake AI), set E2E_BASE_URL, e.g.
 * E2E_BASE_URL=http://localhost:8100 npm run test:e2e. No web server is
 * started then; each worker (and each test that needs a fresh start) gets
 * its own workspace through /api/dev/workspace, and the tests that depend on
 * the mock's sample campaign are skipped.
 */
const externalBaseUrl = process.env.E2E_BASE_URL
const port = Number(process.env.E2E_PORT ?? 5199)
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  // Separate folders per run when several runs share the checkout (E2E_OUTPUT_DIR / E2E_REPORT_DIR).
  outputDir: process.env.E2E_OUTPUT_DIR ?? "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: process.env.E2E_REPORT_DIR ?? "playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // No transitions mid-way during axe colour checks.
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npm run dev:mock -- --port ${port} --strictPort --host 127.0.0.1`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
})
