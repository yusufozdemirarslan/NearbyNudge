import { expect, test, usingRealBackend } from "./fixtures"

test.describe("sent screen", () => {
  test.skip(usingRealBackend, "Uses the mock adapter's sample data")

  test("lists approved emails first, with filters in the URL", async ({ page }) => {
    await page.goto("/sent")
    await expect(page.getByRole("heading", { level: 1, name: "Sent" })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Approved/ })).toHaveAttribute("aria-selected", "true")
    await expect(page.locator("[data-sent-id]")).toHaveCount(2)
    await page.getByRole("tab", { name: /Replied/ }).click()
    await expect(page).toHaveURL(/status=replied/)
    await expect(page.locator("[data-sent-id]").first()).toContainText("Replied")
  })

  test("mark as sent in one click fills the meter, and Undo puts it back", async ({ page }) => {
    await page.goto("/sent")
    const meter = page.locator('[data-slot="top-bar"]').getByRole("meter", { name: "Sent today" })
    await expect(meter).toHaveAttribute("aria-valuetext", "7 of 20")
    const row = page.locator("[data-sent-id]").filter({ hasText: "Sample Duct Masters" })
    await row.getByRole("button", { name: "Mark as sent" }).click()
    await expect(meter).toHaveAttribute("aria-valuetext", "8 of 20")
    await expect(page.locator("[data-sent-id]").filter({ hasText: "Sample Duct Masters" })).toHaveCount(0)
    await page.getByRole("button", { name: "Undo" }).click()
    await expect(meter).toHaveAttribute("aria-valuetext", "7 of 20")
    await expect(page.locator("[data-sent-id]").filter({ hasText: "Sample Duct Masters" })).toHaveCount(1)
  })

  test("No thanks logs the reply and adds the business to do not contact", async ({ page }) => {
    await page.goto("/sent?status=sent")
    const row = page.locator("[data-sent-id]").filter({ hasText: "Sample Bright Dental" })
    await row.getByRole("button", { name: "No thanks" }).click()
    await expect(page.getByText("Sample Bright Dental: No thanks. Added to your do-not-contact list.")).toBeVisible()
    await page.getByRole("tab", { name: /Replied/ }).click()
    await expect(page.locator("[data-sent-id]").filter({ hasText: "Sample Bright Dental" })).toContainText("No thanks")
  })

  test("opens a lead in its campaign's review desk", async ({ page }) => {
    await page.goto("/sent?status=sent")
    await page.getByRole("link", { name: "Sample Bright Dental" }).click()
    await expect(page).toHaveURL(/\/campaigns\/c1\?.*lead=/)
    await expect(page.locator('[data-slot="lead-header"] h2')).toHaveText(
      "Sample Bright Dental"
    )
  })

  test("at the daily cap the send buttons lock and say why", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("nn-mock-sent-today", "20"))
    await page.goto("/sent")
    await expect(page.getByText(/You've marked 20 emails as sent today, the daily limit/)).toBeVisible()
    await expect(page.locator("[data-sent-id]").first().getByRole("button", { name: "Mark as sent" })).toBeDisabled()
  })
})
