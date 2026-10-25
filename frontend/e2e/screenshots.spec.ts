import { expect, LIVE_CAMPAIGN, mockSettings, test, usingRealBackend } from "./fixtures"

/*
 * Reference screenshots for design review (not pixel assertions): the review
 * desk at the three layouts in light and dark, plus the Sent screen.
 * Saved to e2e/.screens/ (git-ignored).
 */
test.skip(usingRealBackend, "Uses the mock adapter's sample data")

const SIZES = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
  { name: "390", width: 390, height: 844 },
]

for (const theme of ["light", "dark"] as const) {
  for (const size of SIZES) {
    test(`desk ${size.name} ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
      await page.setViewportSize({ width: size.width, height: size.height })
      await mockSettings(page, { "nn-mock-speed": "0" })
      await page.goto(LIVE_CAMPAIGN)
      await expect(page.getByRole("heading", { level: 1, name: /Dentists within 5 mi/ })).toBeVisible()
      if (size.width < 840) {
        await page.getByRole("link", { name: /Sample Dental Studio/ }).click()
      }
      await expect(page.locator('[data-slot="email-text"]')).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `e2e/.screens/desk-${size.name}-${theme}.png` })
    })
  }

  test(`desk sending preview ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await mockSettings(page, { "nn-mock-speed": "0" })
    await page.goto(LIVE_CAMPAIGN)
    await expect(page.locator('[data-slot="email-text"]')).toBeVisible()
    await page.keyboard.press("a")
    await expect(page.locator('[data-slot="sending-preview"]')).toBeVisible()
    await page.getByRole("button", { name: "Dismiss message" }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `e2e/.screens/desk-approved-1440-${theme}.png` })
  })

  test(`sent ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.goto("/sent?status=all")
    await expect(page.locator("[data-sent-id]").first()).toBeVisible()
    await page.screenshot({ path: `e2e/.screens/sent-1440-${theme}.png` })
  })
}
