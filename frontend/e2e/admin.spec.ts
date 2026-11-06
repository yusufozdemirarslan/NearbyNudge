import { expect, test, type Page } from "@playwright/test"
import { apiRequest, devWorkspace } from "./accounts"
import { expectNoAxeViolations, usingRealBackend } from "./fixtures"

/*
 * Admin console (/admin) against the real backend. It is open to everyone
 * (there is no admin role). Admin data is shared by the whole server, so
 * these tests look for the rows they create (unique domains) instead of
 * exact counts.
 */

test.skip(!usingRealBackend, "Needs the real backend (set E2E_BASE_URL)")

const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

function section(page: Page, title: string) {
  return page.getByRole("main").locator("section").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) })
}

async function openAdmin(page: Page) {
  await devWorkspace(page, { tag: "admin" })
  await page.goto("/admin")
  await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible()
}

test.describe("admin console", () => {
  test("shows AI status, spend tiles and the daily cost chart with a table view", async ({ page }) => {
    await openAdmin(page)
    // Open to everyone: in the navigation, and the API answers without an admin role.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect((await apiRequest(page, "GET", "/api/admin/overview")).status).toBe(200)
    const sections = page.getByRole("navigation", { name: "Admin sections" }).getByRole("link")
    await expect(sections).toHaveText(["AI status", "Spend", "Balance", "Queue and quality", "Audit sample", "Errors", "AI calls", "Opt-outs"])
    const status = section(page, "AI status")
    await expect(status.getByText("Running")).toBeVisible()
    await expect(status.getByText("claude-sonnet-5-5")).toBeVisible()

    const spend = section(page, "Spend")
    for (const label of ["Today", "Last 7 days", "Last 30 days", "Per lead, average", "Requests today"]) {
      await expect(spend.locator("[data-slot=stat-tile]").filter({ hasText: new RegExp(`^${label}`) })).toBeVisible()
    }
    const daily = spend.locator("[data-slot=chart-card]")
    await expect(daily.getByRole("heading", { name: "Daily cost, last 30 days" })).toBeVisible()
    await expect(daily.locator("svg.recharts-surface")).toBeVisible()
    await daily.getByRole("button", { name: "Table" }).click()
    const table = daily.getByRole("table", { name: "Daily AI cost, last 30 days" })
    await expect(table.getByRole("row")).toHaveCount(31)
    await expect(table.getByRole("columnheader", { name: "Cost" })).toBeVisible()

    await expect(section(page, "Queue and quality").getByRole("list", { name: "Quality measures" })).toContainText(
      "Target 98% or more"
    )
    await expectNoAxeViolations(page, "admin console")
    await page.emulateMedia({ colorScheme: "dark" })
    await expect(page.locator("html")).toHaveClass(/dark/)
    await expectNoAxeViolations(page, "admin console, dark")
  })

  test("saves a prepaid balance and shows the forecast", async ({ page }) => {
    await openAdmin(page)
    const balance = section(page, "Balance forecast")
    const input = balance.getByRole("textbox", { name: "Current prepaid balance" })

    await input.fill("lots")
    await balance.getByRole("button", { name: "Save balance" }).click()
    await expect(balance.getByText("Enter dollars and cents only, like 50 or 125.40.")).toBeVisible()
    await expect(input).toBeFocused()
    await expect(input).toHaveAttribute("aria-invalid", "true")

    // A comma only counts as a thousands separator ("1,50" isn't $150), and the server's limit is $1,000,000.
    await input.fill("1,50")
    await balance.getByRole("button", { name: "Save balance" }).click()
    await expect(balance.getByText("Enter dollars and cents only, like 50 or 125.40.")).toBeVisible()
    await input.fill("2,000,000")
    await balance.getByRole("button", { name: "Save balance" }).click()
    await expect(balance.getByText("Enter a balance of $1,000,000 or less.")).toBeVisible()

    await input.fill("125.40")
    await balance.getByRole("button", { name: "Save balance" }).click()
    await expect(balance.getByText("$125.40").first()).toBeVisible()
    for (const label of ["Spent since", "Remaining", "Average a day, last 7 days", "Days left"]) {
      await expect(balance.getByText(label, { exact: true })).toBeVisible()
    }
    const overview = await apiRequest<{ balance: { amount: number } }>(page, "GET", "/api/admin/overview")
    expect(overview.body.balance.amount).toBe(125.4)
  })

  test("adds and removes a site-owner opt-out", async ({ page }) => {
    await openAdmin(page)
    const optOuts = section(page, "Site-owner opt-outs")
    await optOuts.getByRole("button", { name: "Add opt-out" }).click()
    const domainInput = optOuts.getByRole("textbox", { name: "Website domain" })
    await expect(optOuts.getByText("Enter the site's domain, like example.com.")).toBeVisible()
    await expect(domainInput).toBeFocused()

    const domain = `quiet-${stamp()}.example`
    await domainInput.fill(domain)
    await optOuts.getByRole("textbox", { name: /^Owner's email/ }).fill(`owner@${domain}`)
    await optOuts.getByRole("textbox", { name: /^Note/ }).fill("Asked by email")
    await optOuts.getByRole("button", { name: "Add opt-out" }).click()
    const row = optOuts.getByRole("row").filter({ hasText: domain })
    await expect(row).toContainText(`owner@${domain}`)
    await expect(domainInput).toHaveValue("")

    await row.getByRole("button", { name: `Remove the opt-out for ${domain}` }).click()
    await expect(row).toContainText(`NearbyNudgeBot may read ${domain} again.`)
    await row.getByRole("button", { name: "Remove opt-out" }).click()
    await expect(optOuts.getByRole("row").filter({ hasText: domain })).toHaveCount(0)
    const list = await apiRequest<{ domain: string }[]>(page, "GET", "/api/admin/optouts")
    expect(list.body.some((item) => item.domain === domain)).toBe(false)
  })

  test("audits a fact from a recent lead", async ({ page }) => {
    test.setTimeout(150_000)
    await devWorkspace(page, { tag: "auditor" })
    // A finished campaign guarantees at least one lead with facts in the sample.
    const input = {
      location: "Arlington, VA",
      radius_mi: 5,
      industry: "Dentists",
      offer_what: "Google Ads for dental practices",
      offer_proof: "",
      offer_cta: "Free 15-minute audit",
      tone: "professional",
      lead_target: 5,
    }
    const plan = await apiRequest<{ plan_id: string; question: unknown }>(page, "POST", "/api/campaigns/plan", input)
    expect(plan.status).toBe(200)
    const created = await apiRequest<{ id: string }>(page, "POST", "/api/campaigns", {
      plan_id: plan.body.plan_id,
      input,
      answer: plan.body.question ? "no" : null,
    })
    expect(created.status).toBe(200)
    await expect
      .poll(async () => (await apiRequest<{ status: string }>(page, "GET", `/api/campaigns/${created.body.id}`)).body.status, {
        timeout: 90_000,
        intervals: [1000],
      })
      .toMatch(/done|failed/)

    await page.goto("/admin")
    const audit = section(page, "Audit sample")
    const firstLead = audit.locator("details").first()
    await expect(firstLead).toHaveAttribute("open", "")
    const facts = firstLead.getByRole("listitem")
    await expect(facts.first()).toBeVisible()
    const supported = facts.first().getByRole("button", { name: "Supported", exact: true })
    await expect(supported).toHaveAttribute("aria-pressed", "false")
    await supported.click()
    await expect(supported).toHaveAttribute("aria-pressed", "true")
    await expect(facts.first().getByRole("button", { name: "Not supported" })).toHaveAttribute("aria-pressed", "false")
    await expect(page.getByTestId("announcer")).toHaveText("Marked supported")
    await expectNoAxeViolations(page, "admin console, audit sample")
  })
})
