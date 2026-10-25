import { readFile } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"
import { apiRequest, devWorkspace } from "./accounts"
import { expectNoAxeViolations, usingRealBackend } from "./fixtures"

/*
 * Numbers (/numbers) against the real backend: each test uses its own
 * workspace and, where it needs data, runs a small campaign through the API
 * (Arlington, VA dentists from the fixture listings, fake AI, about 10 s).
 */

test.skip(!usingRealBackend, "Needs the real backend (set E2E_BASE_URL)")

interface LeadRow {
  id: string
  status: string
}

const INPUT = {
  location: "Arlington, VA",
  radius_mi: 5,
  industry: "Dentists",
  offer_what: "Google Ads for dental practices",
  offer_proof: "Grew bookings 30% for a Fairfax practice",
  offer_cta: "Free 15-minute audit",
  tone: "professional",
  lead_target: 5,
}

/** Runs a campaign to the end, then approves two drafts and marks one sent. */
async function seedCampaign(page: Page) {
  const plan = await apiRequest<{ plan_id: string; question: unknown }>(page, "POST", "/api/campaigns/plan", INPUT)
  expect(plan.status, JSON.stringify(plan.body)).toBe(200)
  const created = await apiRequest<{ id: string; name: string }>(page, "POST", "/api/campaigns", {
    plan_id: plan.body.plan_id,
    input: INPUT,
    answer: plan.body.question ? "no" : null,
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  const id = created.body.id
  await expect
    .poll(async () => (await apiRequest<{ status: string }>(page, "GET", `/api/campaigns/${id}`)).body.status, {
      timeout: 90_000,
      intervals: [1000],
    })
    .toMatch(/done|failed/)
  const leads = (await apiRequest<LeadRow[]>(page, "GET", `/api/campaigns/${id}/leads`)).body
  const drafts = leads.filter((lead) => lead.status === "ready" || lead.status === "needs_review")
  expect(drafts.length, "the fixture campaign should produce drafts").toBeGreaterThanOrEqual(2)
  for (const lead of drafts.slice(0, 2)) {
    expect((await apiRequest(page, "POST", `/api/leads/${lead.id}/approve`)).status).toBe(200)
  }
  expect((await apiRequest(page, "POST", `/api/leads/${drafts[0].id}/sent`)).status).toBe(200)
  const stats = (await apiRequest<{ totals: { found: number } }>(page, "GET", "/api/stats")).body
  return { name: created.body.name, found: stats.totals.found }
}

test.describe("numbers", () => {
  test("explains itself before the first campaign", async ({ page }) => {
    await devWorkspace(page, { tag: "numbers-empty" })
    await page.goto("/numbers")
    await expect(page.getByRole("heading", { level: 1, name: "Numbers" })).toBeVisible()
    await expect(page.getByText("No numbers yet")).toBeVisible()
    await expect(page.getByRole("link", { name: "New campaign" }).last()).toHaveAttribute("href", "/campaigns/new")
    await expect(page.getByRole("meter", { name: "Sent today" }).first()).toHaveAttribute("aria-valuetext", "0 of 20")
    await expectNoAxeViolations(page, "numbers, empty")
  })

  test("shows the headline row, funnel and weekly charts, each with a table view", async ({ page }) => {
    test.setTimeout(150_000)
    await devWorkspace(page, { tag: "numbers" })
    const seeded = await seedCampaign(page)
    await page.goto("/numbers")
    const main = page.getByRole("main")

    // Headline row: this week against last week, with all-time totals.
    await expect(main.getByRole("heading", { level: 2, name: "This week" })).toBeVisible()
    const found = main.locator("[data-slot=stat-tile]").filter({ hasText: /^Found/ })
    await expect(found).toContainText(String(seeded.found))
    await expect(found).toContainText(`${seeded.found} more than last week (0)`)
    await expect(found).toContainText(`${seeded.found} all time`)
    await expect(main.locator("[data-slot=stat-tile]").filter({ hasText: /^Approved/ })).toContainText("2 more than last week")
    await expect(main.locator("[data-slot=stat-tile]").filter({ hasText: /^Reply rate/ })).toContainText("0%")

    // Today's sending meter.
    await expect(main.getByRole("meter", { name: "Sent today" })).toHaveAttribute("aria-valuetext", "1 of 20")

    // Funnel: four steps with values, then its table view.
    const funnel = main.locator("section").filter({ has: page.getByRole("heading", { name: "Funnel" }) })
    const steps = funnel.getByRole("list", { name: "Funnel steps" }).getByRole("listitem")
    await expect(steps).toHaveCount(4)
    await expect(steps.nth(1)).toContainText("Approved")
    await expect(steps.nth(2)).toContainText(`${Math.round((1 / seeded.found) * 100)}% of found`)
    await funnel.getByRole("button", { name: "Table" }).click()
    await expect(funnel.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true")
    const funnelTable = funnel.getByRole("table", { name: "Funnel, all campaigns" })
    await expect(funnelTable.getByRole("row", { name: /Sent 1/ })).toBeVisible()

    // By campaign.
    await expect(main.getByRole("table", { name: "Numbers by campaign" }).getByRole("link", { name: seeded.name })).toBeVisible()

    // One small chart per measure, each with its own table view.
    for (const name of ["Found", "Approved", "Sent", "Replies"]) {
      const card = main.locator("[data-slot=chart-card]").filter({ has: page.getByRole("heading", { level: 3, name }) })
      await expect(card.locator("svg.recharts-surface")).toBeVisible()
    }
    const foundCard = main.locator("[data-slot=chart-card]").filter({ has: page.getByRole("heading", { level: 3, name: "Found" }) })
    await expect(foundCard.locator(".recharts-label-list text")).toHaveText(String(seeded.found))
    await foundCard.getByRole("button", { name: "Table" }).click()
    const weekly = foundCard.getByRole("table", { name: "Found by week" })
    await expect(weekly.getByRole("row")).toHaveCount(9)
    // Newest week first; the value cell (not the date) holds this week's count.
    await expect(weekly.getByRole("row").nth(1).getByRole("cell")).toHaveText(String(seeded.found))
    await foundCard.getByRole("button", { name: "Chart" }).click()
    await expect(foundCard.locator("svg.recharts-surface")).toBeVisible()

    await expectNoAxeViolations(page, "numbers, light")
    await page.emulateMedia({ colorScheme: "dark" })
    await expect(page.locator("html")).toHaveClass(/dark/)
    await expectNoAxeViolations(page, "numbers, dark")
  })

  test("exports a CSV of the numbers", async ({ page }) => {
    test.setTimeout(150_000)
    await devWorkspace(page, { tag: "numbers-csv" })
    const seeded = await seedCampaign(page)
    await page.goto("/numbers")
    await expect(page.getByRole("heading", { level: 2, name: "This week" })).toBeVisible()
    const downloading = page.waitForEvent("download")
    await page.getByRole("button", { name: "Export CSV" }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe("nearbynudge-numbers.csv")
    const text = await readFile((await download.path())!, "utf8")
    expect(text).toContain("Section,Campaign or week,Found,Approved,Sent,Replied")
    expect(text).toContain(seeded.name)
    await expect(page.getByTestId("announcer")).toHaveText("Downloaded nearbynudge-numbers.csv")
  })
})
