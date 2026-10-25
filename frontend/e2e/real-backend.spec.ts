import { request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test"
import { E2E_WORKSPACE, expect, expectNoAxeViolations, test, usingRealBackend } from "./fixtures"

/*
 * Runs only against a real backend (E2E_BASE_URL), e.g. the backend's
 * scripts/e2e_server.py with fixture sites and the fake AI. It creates one
 * "Dentists near Arlington, VA" campaign through the API, waits for research
 * to finish, then drives the review desk without assuming business names.
 */
test.skip(!usingRealBackend, "Runs only against a real backend (set E2E_BASE_URL)")
test.describe.configure({ mode: "serial" })

let campaignId = ""
let campaignName = ""

/** An API client in this worker's workspace (the same one the page fixture uses). */
async function workspaceApi(): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: process.env.E2E_BASE_URL })
  await api.get("/api/me")
  const csrf = (await api.storageState()).cookies.find((c) => c.name === "nn_csrf")?.value ?? ""
  const workspace = await api.post("/api/dev/workspace", { data: { key: E2E_WORKSPACE }, headers: { "X-CSRF-Token": csrf } })
  expect(workspace.ok(), "POST /api/dev/workspace needs the test server (backend/scripts/e2e_server.py)").toBeTruthy()
  // Single-key shortcuts and live updates on, whatever earlier tests left behind.
  const account = await (await api.get("/api/account")).json()
  const prefs = await api.put("/api/account/preferences", {
    data: { ...account.preferences, shortcuts_enabled: true, live_updates: true },
    headers: { "X-CSRF-Token": await csrfOf(api) },
  })
  expect(prefs.ok(), await prefs.text()).toBeTruthy()
  return api
}

async function csrfOf(api: APIRequestContext) {
  return (await api.storageState()).cookies.find((c) => c.name === "nn_csrf")?.value ?? ""
}

test.beforeAll(async () => {
  test.setTimeout(150_000)
  const api = await workspaceApi()
  const input = {
    location: "Arlington, VA",
    radius_mi: 5,
    industry: "Dentists",
    offer_what: "Google Ads for dental practices",
    offer_proof: "Grew bookings 30% for a Fairfax practice",
    offer_cta: "Free 15-minute audit",
    tone: "professional",
    lead_target: 5,
  }
  const planResponse = await api.post("/api/campaigns/plan", { data: input, headers: { "X-CSRF-Token": await csrfOf(api) } })
  expect(planResponse.ok(), await planResponse.text()).toBeTruthy()
  const plan = await planResponse.json()
  const created = await api.post("/api/campaigns", {
    data: { plan_id: plan.plan_id, input, answer: plan.question ? "no" : null },
    headers: { "X-CSRF-Token": await csrfOf(api) },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const campaign = await created.json()
  campaignId = campaign.id
  campaignName = campaign.name
  // Wait for research to finish (about 10 s with the fake AI).
  await expect
    .poll(
      async () => {
        const c = await (await api.get(`/api/campaigns/${campaignId}`)).json()
        return c.status
      },
      { timeout: 120_000, intervals: [1000] }
    )
    .toMatch(/done|failed/)
  await api.dispose()
})

async function openDesk(page: Page, query = "") {
  await page.goto(`/campaigns/${campaignId}${query}`)
  await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible()
}

/** Opens the first lead that still needs a decision and waits for its email. */
async function openActionable(page: Page) {
  await openDesk(page, "?view=all")
  const row = page.locator("li[data-lead-id]").filter({ hasText: /Ready|Needs review/ }).first()
  await expect(row).toBeVisible()
  const name = (await row.locator("[data-row-link] .truncate").first().innerText()).trim()
  await row.locator("[data-row-link]").click()
  await expect(page.locator('[data-slot="lead-header"] h2')).toHaveText(name)
  await expect(page.locator('[data-slot="email-text"]')).toBeVisible()
  return name
}

test("the desk shows the finished campaign with its leads", async ({ page }) => {
  await openDesk(page, "?view=all")
  await expect(page.locator("li[data-lead-id]").first()).toBeVisible()
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /\d+ of \d+ ready/)
  await expect(page.getByText("Research finished", { exact: true })).toBeVisible()
  // A lead whose research ended shows no "still looking for a contact" placeholder.
  const ended = page.locator("li[data-lead-id]").filter({ hasText: "Couldn't finish" }).first()
  await expect(ended).toBeVisible()
  await expect(ended).not.toContainText("Contact not found yet")
  // Phone numbers read the way people write them.
  await ended.locator("[data-row-link]").click()
  await expect(page.locator('[data-slot="lead-header"] a[href^="tel:"]')).toHaveText(/^\(\d{3}\) \d{3}-\d{4}$/u)
})

test("J and K move between leads and update the URL", async ({ page }) => {
  await openDesk(page, "?view=all")
  await page.locator("li[data-lead-id] [data-row-link]").first().click()
  await expect(page).toHaveURL(/lead=/)
  const first = new URL(page.url()).searchParams.get("lead")
  await page.keyboard.press("j")
  await expect.poll(() => new URL(page.url()).searchParams.get("lead")).not.toBe(first)
  await page.keyboard.press("k")
  await expect.poll(() => new URL(page.url()).searchParams.get("lead")).toBe(first)
})

test("approve → sending preview → mark as sent → Z undoes it", async ({ page }) => {
  await openActionable(page)
  const meter = page.locator('[data-slot="top-bar"]').getByRole("meter", { name: "Sent today" })
  const before = await meter.getAttribute("aria-valuenow")
  await page.keyboard.press("a")
  const anyway = page.getByRole("button", { name: "Approve anyway" })
  if (await anyway.isVisible().catch(() => false)) await anyway.click()
  const preview = page.locator('[data-slot="sending-preview"]')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText("NearbyNudge doesn't send")
  await page.keyboard.press("m")
  await expect(meter).toHaveAttribute("aria-valuenow", String(Number(before) + 1))
  await page.keyboard.press("z")
  await expect(meter).toHaveAttribute("aria-valuenow", String(before))
})

test("skip with reason chip 2", async ({ page }) => {
  const name = await openActionable(page)
  await page.keyboard.press("s")
  await expect(page.getByRole("group", { name: /why\?/ })).toBeVisible()
  await page.keyboard.press("2")
  await expect(page.getByText(`${name}: Not a fit`)).toBeVisible()
})

test("do not contact asks in place", async ({ page }) => {
  const name = await openActionable(page)
  await page.keyboard.press("Shift+D")
  const confirm = page.getByRole("button", { name: `Never contact ${name}` })
  await expect(confirm).toBeFocused()
  await confirm.click()
  await expect(page.getByText(`${name} is on your do-not-contact list.`)).toBeVisible()
})

test("a rewrite shows Rewriting, then Show changes", async ({ page }) => {
  test.setTimeout(90_000)
  await openActionable(page)
  await page.keyboard.press("1")
  await expect(page.locator('[data-slot="email-panel"]').getByRole("status").filter({ hasText: "Rewriting" })).toBeVisible()
  const show = page.getByRole("button", { name: "Show changes" })
  await expect(show).toBeVisible({ timeout: 60_000 })
  await show.click()
  await expect(page.locator('[data-slot="changes-view"]')).toBeVisible()
})

test("a source tag previews its quote on focus and closes on Esc", async ({ page }) => {
  await openActionable(page)
  const tag = page.locator('[data-fact-id] a[data-kind="site"]').first()
  test.skip((await tag.count()) === 0, "This lead has no site facts")
  // The row was opened with the mouse; a key press makes the next focus keyboard focus.
  await page.keyboard.press("Shift")
  await tag.focus()
  const preview = page.locator('[data-slot="hover-card-content"]')
  await expect(preview).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(preview).toBeHidden()
})

test("axe: review desk and Sent have no violations", async ({ page }) => {
  await openActionable(page)
  await expectNoAxeViolations(page, "real desk")
  await page.goto("/sent?status=all")
  await expect(page.getByRole("heading", { level: 1, name: "Sent" })).toBeVisible()
  await expectNoAxeViolations(page, "real sent")
})
