import type { Page } from "@playwright/test"
import { expect, LIVE_CAMPAIGN, mockSettings, test, usingRealBackend } from "./fixtures"

// These tests use the mock adapter's live sample campaign (c1).
test.skip(usingRealBackend, "Uses the mock adapter's sample campaign")

const topMeter = (page: Page) => page.locator('[data-slot="top-bar"]').getByRole("meter", { name: "Sent today" })
const selectedName = (page: Page) => page.locator('[data-slot="lead-header"] h2')
const leadParam = (page: Page) => new URL(page.url()).searchParams.get("lead")

async function openDesk(page: Page, query = "") {
  await page.goto(`${LIVE_CAMPAIGN}${query}`)
  await expect(page.getByRole("heading", { level: 1, name: /Dentists within 5 mi/ })).toBeVisible()
}

/** Waits until the selected lead's email has loaded, so shortcuts act on it. */
async function emailReady(page: Page, name: string) {
  await expect(selectedName(page)).toHaveText(name)
  await expect(page.locator('[data-slot="email-text"]')).toBeVisible()
}

test.describe("review desk layout", () => {
  test("three columns at 1440 × 900", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    const list = await page.getByRole("tabpanel").first().boundingBox()
    const email = await page.locator('[data-slot="email-panel"]').boundingBox()
    const evidence = await page.locator('[data-slot="evidence"]').boundingBox()
    expect(list && email && evidence).toBeTruthy()
    // list | email | evidence, side by side
    expect(email!.x).toBeGreaterThan(list!.x + list!.width - 1)
    expect(evidence!.x).toBeGreaterThan(email!.x + email!.width - 1)
    expect(Math.abs(evidence!.y - email!.y)).toBeLessThan(40)
    // facts sit beside the sentences that cite them
    await expect(page.locator('[data-slot="evidence"] ul[data-aligned="true"]')).toHaveCount(1)
  })

  test("evidence moves under the email at 1024 × 768", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    const email = await page.locator('[data-slot="email-panel"]').boundingBox()
    const evidence = await page.locator('[data-slot="evidence"]').boundingBox()
    expect(evidence!.y).toBeGreaterThan(email!.y + email!.height - 1)
    expect(Math.abs(evidence!.x - email!.x)).toBeLessThan(40)
    await expect(page.getByRole("tabpanel").first()).toBeVisible()
  })

  test("one pane at a time at 390 × 844", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDesk(page)
    // The list comes first; nothing is opened automatically on a phone.
    await expect(page.locator('[data-slot="email-panel"]')).toHaveCount(0)
    await page.getByRole("link", { name: /Sample Dental Studio/ }).click()
    await expect(page).toHaveURL(/lead=/)
    await expect(page.locator('[data-slot="email-panel"]')).toBeVisible()
    await expect(page.getByRole("tabpanel")).toHaveCount(0)
    // Sticky bottom bar with Approve, Skip and More, at phone-size targets.
    const bar = page.locator('[data-slot="action-bar"]')
    await expect(bar.getByRole("button", { name: "Approve" })).toBeVisible()
    await expect(bar.getByRole("button", { name: "Skip" })).toBeVisible()
    await expect(bar.getByRole("button", { name: "More actions" })).toBeVisible()
    const approve = await bar.getByRole("button", { name: "Approve" }).boundingBox()
    expect(approve!.height).toBeGreaterThanOrEqual(44)
    // Back returns to the list.
    await page.getByRole("button", { name: "All leads" }).click()
    await expect(page.getByRole("tabpanel")).toBeVisible()
    await expect(page.locator('[data-slot="email-panel"]')).toHaveCount(0)
  })
})

test.describe("review desk keyboard", () => {
  test("J and K move through leads and keep the lead in the URL", async ({ page }) => {
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    const first = leadParam(page)
    expect(first).toBeTruthy()
    await page.keyboard.press("j")
    await expect(selectedName(page)).toHaveText("Sample Family Dental")
    await expect.poll(() => leadParam(page)).not.toBe(first)
    await expect(page.locator("li[data-selected]")).toContainText("Sample Family Dental")
    await page.keyboard.press("k")
    await expect(selectedName(page)).toHaveText("Sample Dental Studio")
    await expect.poll(() => leadParam(page)).toBe(first)
  })

  test("approve opens the sending preview; mark as sent fills the meter; Z undoes it", async ({ page }) => {
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    await expect(topMeter(page)).toHaveAttribute("aria-valuetext", "7 of 20")

    await page.keyboard.press("a")
    const preview = page.locator('[data-slot="sending-preview"]')
    await expect(preview).toBeVisible()
    await expect(preview).toContainText("Approved. NearbyNudge doesn't send; use your own email account.")
    await expect(preview.locator('[data-slot="send-to"]')).toHaveText("office@samplestudio.example")
    await expect(preview.getByRole("button", { name: /Copy email/ })).toBeVisible()
    const open = preview.getByRole("link", { name: /Open in my email app/ })
    await expect(open).toBeVisible()
    await expect(open).toHaveAttribute("href", /^mailto:office@samplestudio\.example\?subject=/)
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible()

    await page.keyboard.press("m")
    await expect(topMeter(page)).toHaveAttribute("aria-valuetext", "8 of 20")
    // Auto-advance to the next lead that needs a decision.
    await expect(selectedName(page)).toHaveText("Sample Family Dental")

    await page.keyboard.press("z")
    await expect(topMeter(page)).toHaveAttribute("aria-valuetext", "7 of 20")
    await expect(selectedName(page)).toHaveText("Sample Dental Studio")
    await expect(page.locator('[data-slot="sending-preview"]')).toBeVisible()
  })

  test("skip takes two keys: S then a numbered reason", async ({ page }) => {
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    await page.keyboard.press("s")
    const reasons = page.getByRole("group", { name: /Skip Sample Dental Studio: why\?/ })
    await expect(reasons).toBeVisible()
    await expect(reasons.getByRole("button", { name: "Not a fit" })).toBeVisible()
    await page.keyboard.press("2")
    await expect(selectedName(page)).toHaveText("Sample Family Dental")
    await expect(page.getByText("Sample Dental Studio: Not a fit")).toBeVisible()
    await page.getByRole("tab", { name: /Skipped/ }).click()
    await expect(page.locator("li[data-lead-id]").filter({ hasText: "Sample Dental Studio" })).toContainText("Skipped")
  })

  test("do not contact asks in place with a button that names the business", async ({ page }) => {
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    await page.keyboard.press("Shift+D")
    const confirm = page.getByRole("button", { name: "Never contact Sample Dental Studio" })
    await expect(confirm).toBeVisible()
    await expect(confirm).toBeFocused()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    // Cancel keeps everything as it was.
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(confirm).toBeHidden()
    await page.keyboard.press("Shift+D")
    await page.getByRole("button", { name: "Never contact Sample Dental Studio" }).click()
    await expect(page.getByText("Sample Dental Studio is on your do-not-contact list.")).toBeVisible()
    await expect(selectedName(page)).toHaveText("Sample Family Dental")
  })

  test("a rewrite keeps the text readable, then offers Show changes and Undo", async ({ page }) => {
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    const body = page.locator('[data-slot="email-text"]')
    await expect(body).toContainText("which is a real advantage in a crowded market")
    await page.keyboard.press("1")
    await expect(page.locator('[data-slot="email-panel"]').getByRole("status").filter({ hasText: "Rewriting: shorter" })).toBeVisible()
    await expect(body).toBeVisible()
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible()
    const show = page.getByRole("button", { name: "Show changes" })
    await expect(show).toBeVisible({ timeout: 15_000 })
    await expect(body).not.toContainText("which is a real advantage")
    await show.click()
    const changes = page.locator('[data-slot="changes-view"]')
    await expect(changes).toBeVisible()
    await expect(changes.locator("del").first()).toBeVisible()
    // Revert one change: it is saved and stays marked as reverted.
    const firstChange = changes.getByRole("button", { pressed: false }).first()
    await firstChange.click()
    await expect(changes.getByRole("button", { pressed: true })).toHaveCount(1)
    // Undo the whole rewrite.
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.locator('[data-slot="email-text"]')).toContainText("which is a real advantage in a crowded market")
  })

  test("cancelling a rewrite keeps the current email", async ({ page }) => {
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    await page.keyboard.press("2")
    await expect(page.locator('[data-slot="email-panel"]').getByRole("status").filter({ hasText: "Rewriting: friendlier" })).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.locator('[data-slot="email-panel"]').getByRole("status").filter({ hasText: "Rewriting" })).toBeHidden()
    await expect(page.locator('[data-slot="email-text"]')).toContainText("Would a free 15-minute audit")
  })

  test("source tag shows the quote on keyboard focus and closes on Esc", async ({ page }) => {
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    const tag = page.locator('[data-fact-id] a[data-kind="site"]').first()
    await tag.focus()
    const preview = page.locator('[data-slot="hover-card-content"]')
    await expect(preview).toBeVisible()
    await expect(preview).toContainText("Proudly serving Arlington families since 2009.")
    await expect(tag).toHaveAttribute("target", "_blank")
    await expect(tag).toHaveAttribute("rel", "noopener noreferrer")
    await expect(tag).toHaveAttribute("href", /#:~:text=/)
    await page.keyboard.press("Escape")
    await expect(preview).toBeHidden()
  })

  test("pausing live updates stops rows from changing", async ({ page }) => {
    await mockSettings(page, { "nn-mock-speed": "0.6" })
    await openDesk(page, "?view=all")
    const row = page.locator("li[data-lead-id]").filter({ hasText: "Sample Orthodontics" })
    await expect(row).toContainText("Writing")
    await page.getByRole("switch", { name: "Pause live updates" }).click()
    await expect(page.getByRole("switch", { name: "Pause live updates" })).toBeChecked()
    const frozen = await row.innerText()
    await page.waitForTimeout(7_000)
    expect(await row.innerText()).toBe(frozen)
    await expect(page.getByText(/changes? waiting/)).toBeVisible()
    await page.getByRole("switch", { name: "Pause live updates" }).click()
    await expect(row).not.toHaveText(frozen)
  })

  test("? lists the desk's shortcuts", async ({ page }) => {
    await openDesk(page)
    await emailReady(page, "Sample Dental Studio")
    await page.keyboard.press("?")
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" })
    await expect(sheet).toBeVisible()
    for (const text of ["Next lead", "Approve", "Skip, with a reason", "Do not contact (asks first)", "Mark as sent", "Undo the latest action"]) {
      await expect(sheet.getByText(text, { exact: true })).toBeVisible()
    }
  })
})
