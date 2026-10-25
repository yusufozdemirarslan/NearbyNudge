import { expect, test } from "@playwright/test"
import { apiRequest, devWorkspace } from "./accounts"

/*
 * A live run through the dashboard: the real Claude API, real Overture listings and real business
 * websites (backend/scripts/e2e_server.py --live). Skipped unless LIVE_UI=1. Costs about $0.40.
 *
 *   E2E_BASE_URL=http://localhost:8200 LIVE_UI=1 npx playwright test e2e/live-ui.spec.ts
 */

interface CampaignBody {
  id: string
  status: string
  counts: { ready: number; needs_review: number; in_progress: number }
}
interface LeadRow {
  id: string
  name: string
  status: string
}

test.describe("live run through the dashboard", () => {
  test.skip(!process.env.LIVE_UI, "Set LIVE_UI=1 and point E2E_BASE_URL at e2e_server.py --live")
  test.setTimeout(10 * 60_000)

  test("plans, researches and approves a real campaign", async ({ page }) => {
    const shots = process.env.LIVE_SHOTS ?? "../docs/live-ui"
    await devWorkspace(page, { tag: "live", name: "Maya Chen" })

    await page.goto("/campaigns/new")
    const where = page.getByRole("combobox", { name: "Where" })
    await where.fill("Arlington, VA")
    await page.keyboard.press("Escape")
    await page.getByRole("textbox", { name: "Who" }).fill("Dentists")
    await page.getByRole("textbox", { name: "Your offer" }).fill("Google Ads campaigns for dental practices")
    await page
      .getByRole("textbox", { name: "Proof (optional)" })
      .fill("Grew new-patient bookings 30% for a Fairfax practice in 3 months")
    await page.getByRole("textbox", { name: "Ask" }).fill("A free 15-minute ads audit")
    await page.getByRole("spinbutton", { name: "How many" }).fill("5")
    await page.getByRole("button", { name: "Review plan", exact: true }).click()
    const panel = page.getByTestId("plan-panel")
    await expect(panel).toContainText("Claude's plan:", { timeout: 60_000 })
    await page.screenshot({ path: `${shots}/1-new-campaign-plan.png`, fullPage: true })
    const no = panel.getByRole("radio", { name: "No" })
    if (await no.count()) await no.click()
    await panel.getByRole("button", { name: /^Find 5 businesses/ }).click()
    await expect(page).toHaveURL(/\/campaigns\/(?!new)[^/?#]+/, { timeout: 30_000 })
    const campaignId = new URL(page.url()).pathname.split("/").pop() ?? ""

    // Cards appear while research runs.
    await page.waitForTimeout(25_000)
    await page.screenshot({ path: `${shots}/2-desk-researching.png` })

    const deadline = Date.now() + 8 * 60_000
    let campaign: CampaignBody | null = null
    while (Date.now() < deadline) {
      campaign = (await apiRequest<CampaignBody>(page, "GET", `/api/campaigns/${campaignId}`)).body
      if (campaign.status === "done") break
      await page.waitForTimeout(5_000)
    }
    expect(campaign?.status, "the campaign should finish").toBe("done")
    expect((campaign?.counts.ready ?? 0) + (campaign?.counts.needs_review ?? 0)).toBeGreaterThanOrEqual(3)

    const leads = (await apiRequest<LeadRow[]>(page, "GET", `/api/campaigns/${campaignId}/leads`)).body
    const ready = leads.find((lead) => lead.status === "ready") ?? leads.find((lead) => lead.status === "needs_review")
    expect(ready, "a drafted lead").toBeTruthy()
    await page.goto(`/campaigns/${campaignId}?lead=${ready?.id}`)
    await expect(page.getByRole("heading", { name: ready?.name ?? "" }).first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1_500)
    await page.screenshot({ path: `${shots}/3-desk-lead.png` })

    await page.keyboard.press("a")
    await expect(page.getByText("NearbyNudge doesn't send", { exact: false }).first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${shots}/4-sending-preview.png` })

    await page.goto("/numbers")
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: `${shots}/5-numbers.png`, fullPage: true })
    await page.goto("/admin")
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: `${shots}/6-admin.png`, fullPage: true })
  })
})
