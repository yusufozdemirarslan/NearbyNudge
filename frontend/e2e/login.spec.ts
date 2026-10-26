import { expect, test, type Page } from "@playwright/test"
import { apiRequest, devWorkspace } from "./accounts"
import { expectNoAxeViolations } from "./fixtures"

/*
 * Sign-in for the one account. Runs only against a test server started with
 * sign-in on (verify.ps1 does this), e.g.
 *
 *   E2E_LOGIN_PASSWORD=... backend/.venv/Scripts/python.exe backend/scripts/e2e_server.py --port 8101 --login
 *   E2E_BASE_URL=http://localhost:8101 E2E_LOGIN_PASSWORD=... npx playwright test e2e/login.spec.ts
 *
 * It uses @playwright/test directly: the shared fixture's per-test workspace
 * needs a signed-in browser here, so tests switch workspaces after signing in.
 */
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? ""
const EMAIL = process.env.E2E_LOGIN_EMAIL ?? "owner@example.org"
const WRONG = "That email and password don't match. Check them and try again."

test.skip(!process.env.E2E_BASE_URL || !PASSWORD, "Runs against a test server started with --login (E2E_LOGIN_PASSWORD)")

async function signIn(page: Page, password = PASSWORD) {
  await page.getByLabel("Email address").fill(EMAIL)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

test("a signed-out visit asks for sign-in, then goes where it was headed", async ({ page }) => {
  await page.goto("/sent?status=all")
  await expect(page).toHaveURL(/\/login\?redirect=%2Fsent%3Fstatus%3Dall$/u)
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible()
  await expect(page.getByLabel("Email address")).toBeFocused()
  await expect(page.getByText("There’s no sign-up", { exact: false })).toBeVisible()
  await expectNoAxeViolations(page, "sign-in")

  const password = page.getByLabel("Password", { exact: true })
  await signIn(page, "not the password")
  await expect(password).toHaveAttribute("aria-invalid", "true")
  await expect(page.getByText(WRONG)).toBeVisible()
  await expect(password).toBeFocused()
  await expectNoAxeViolations(page, "sign-in, wrong password")

  await page.getByRole("button", { name: "Show password" }).click()
  await expect(password).toHaveAttribute("type", "text")
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Hide password" }).click()
  await expect(password).toHaveAttribute("type", "password")

  await signIn(page)
  // The account's own workspace has no sender profile on a fresh test server, so set-up comes first.
  await expect(page).toHaveURL(/\/onboarding$/u)
  // The session cookie can't be read by scripts.
  expect(await page.evaluate(() => document.cookie)).not.toContain("nn_session")
  const cookie = (await page.context().cookies()).find((c) => c.name === "nn_session")
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe("Lax")
})

test("signing out, and a session that ends mid-visit", async ({ page }) => {
  await page.goto("/login")
  await signIn(page)
  await expect(page).not.toHaveURL(/\/login/u)
  await devWorkspace(page, { tag: "login" })
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Campaigns" })).toBeVisible()
  // A signed-in browser that opens the sign-in page goes straight on.
  await page.goto("/login?redirect=%2Fnumbers")
  await expect(page).toHaveURL(/\/numbers$/u)

  // The session ends (it ran out, or another tab signed out): the next request, a page's own refresh or a
  // click, leads to sign-in, and signing in again goes back to that page.
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Campaigns" })).toBeVisible()
  await page.context().clearCookies({ name: "nn_session" })
  // Moves to Sent inside the app (no page load), unless a refresh has already reached the sign-in page.
  await page.evaluate(() => {
    if (window.location.pathname === "/login") return
    window.history.pushState(null, "", "/sent")
    window.dispatchEvent(new PopStateEvent("popstate"))
  })
  await expect(page).toHaveURL(/\/login\?redirect=%2F/u)
  const back = new URL(page.url()).searchParams.get("redirect") ?? "/"
  expect(back === "/" || back.startsWith("/sent"), back).toBe(true)
  await signIn(page)
  await expect.poll(() => new URL(page.url()).pathname).toBe(new URL(back, page.url()).pathname)

  await page.getByRole("button", { name: /Options menu/u }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/u)
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible()
  expect((await apiRequest(page, "GET", "/api/me")).status).toBe(401)
  await page.goto("/")
  await expect(page).toHaveURL(/\/login\?redirect=%2F$/u)
})

test("public pages and old links work without signing in", async ({ page }) => {
  for (const path of ["/bot", "/privacy", "/terms", "/data-sources"]) {
    await page.goto(path)
    await expect(page, path).toHaveURL(new RegExp(`${path}$`, "u"))
    await expect(page.locator("h1")).toHaveCount(1)
  }
  await page.goto("/signin")
  await expect(page).toHaveURL(/\/login$/u)
  expect((await apiRequest(page, "GET", "/api/auth/session")).body).toEqual({ enabled: true, signed_in: false, email: null })
  expect((await apiRequest(page, "GET", "/api/campaigns")).status).toBe(401)
})
