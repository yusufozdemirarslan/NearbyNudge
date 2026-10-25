import { expect, test, type Page } from "@playwright/test"
import { apiRequest, devWorkspace } from "./accounts"
import { expectNoAxeViolations, usingRealBackend } from "./fixtures"

/*
 * Campaigns home (/): the first-run state is the New campaign form itself;
 * afterwards every campaign is a row with its status, progress and counts,
 * linking to its review desk. Runs against the real backend.
 */

const BRIEF = {
  location: "Arlington, VA",
  radius_mi: 5,
  industry: "Dentists",
  offer_what: "Google Ads for dental practices",
  offer_proof: "",
  offer_cta: "Free 15-minute audit",
  tone: "professional",
  lead_target: 5,
}

/** Plans and starts a campaign through the API; returns its id and name. */
async function startCampaignViaApi(page: Page) {
  const plan = await apiRequest<{ plan_id: string; question: unknown }>(
    page,
    "POST",
    "/api/campaigns/plan",
    BRIEF
  )
  expect(plan.status, JSON.stringify(plan.body)).toBe(200)
  const created = await apiRequest<{ id: string; name: string }>(
    page,
    "POST",
    "/api/campaigns",
    {
      plan_id: plan.body.plan_id,
      input: BRIEF,
      answer: plan.body.question ? "no" : null,
    }
  )
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  return created.body
}

test.describe("campaigns home", () => {
  test.skip(!usingRealBackend, "Needs the real backend (set E2E_BASE_URL)")

  test("a new workspace sees the New campaign form instead of an empty table", async ({
    page,
  }) => {
    await devWorkspace(page, { tag: "home-empty" })
    await page.goto("/")
    await expect(
      page.getByRole("heading", { level: 1, name: "Campaigns" })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { level: 2, name: "Start your first campaign" })
    ).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Where" })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Review plan", exact: true })
    ).toBeVisible()
    await expect(page.getByTestId("campaign-row")).toHaveCount(0)
    await expect(
      page.getByRole("meter", { name: "Sent today" }).first()
    ).toHaveAttribute("aria-valuetext", "0 of 20")
    await expectNoAxeViolations(page, "campaigns home, first run, light")
    await page.emulateMedia({ colorScheme: "dark" })
    await expect(page.locator("html")).toHaveClass(/dark/)
    await expectNoAxeViolations(page, "campaigns home, first run, dark")
  })

  test("lists a campaign with its status and counts and opens its review desk", async ({
    page,
  }) => {
    await devWorkspace(page, { tag: "home-list" })
    const campaign = await startCampaignViaApi(page)
    await page.goto("/")
    await expect(
      page.getByRole("heading", { level: 1, name: "Campaigns" })
    ).toBeVisible()

    const list = page.getByRole("list", { name: "1 campaign" })
    const row = list.getByTestId("campaign-row")
    await expect(row).toHaveCount(1)
    const link = row.getByRole("link", { name: campaign.name })
    await expect(link).toBeVisible()
    await expect(row).toContainText(/Created /)

    // The list refreshes on its own while research runs; the fixture campaign finishes in about 10 s.
    await expect(row).toContainText(/Finding businesses|Researching|Done/)
    await expect(row.getByText("Done", { exact: true })).toBeVisible({
      timeout: 45_000,
    })
    await expect(row).toContainText(/\d+ drafts?/)
    for (const label of ["ready", "approved", "sent", "replies"]) {
      await expect(row).toContainText(label)
    }
    await expect(row.locator('[data-count="ready"]')).toContainText(/\d+ ready/)

    await expectNoAxeViolations(page, "campaigns home with a campaign, light")
    await page.emulateMedia({ colorScheme: "dark" })
    await expect(page.locator("html")).toHaveClass(/dark/)
    await expectNoAxeViolations(page, "campaigns home with a campaign, dark")

    await link.click()
    await expect(page).toHaveURL(new RegExp(`/campaigns/${campaign.id}`))
  })

  test("rows stack on a phone without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await devWorkspace(page, { tag: "home-phone" })
    const campaign = await startCampaignViaApi(page)
    await page.goto("/")
    const row = page.getByTestId("campaign-row")
    await expect(row.getByRole("link", { name: campaign.name })).toBeVisible()
    await expect(row).toContainText(/ready/)
    const overflow = await page.evaluate(() => {
      const main = document.getElementById("main-content")
      return {
        page:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        main: main ? main.scrollWidth - main.clientWidth : 0,
      }
    })
    expect(overflow.page).toBeLessThanOrEqual(0)
    expect(overflow.main).toBeLessThanOrEqual(0)
    await expectNoAxeViolations(page, "campaigns home at 390 px")
  })
})
