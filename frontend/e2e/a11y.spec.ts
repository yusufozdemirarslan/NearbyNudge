import type { Page } from "@playwright/test"
import { expect, expectNoAxeViolations, LIVE_CAMPAIGN, mockSettings, test, usingRealBackend } from "./fixtures"

/*
 * axe (WCAG 2.0, 2.1 and 2.2 A/AA rules) on every screen and state FE-A built.
 * The mock is frozen (speed 0) so each scan sees a stable page.
 */
test.skip(usingRealBackend, "Uses the mock adapter's sample data")

async function desk(page: Page, query = "") {
  await mockSettings(page, { "nn-mock-speed": "0" })
  await page.goto(`${LIVE_CAMPAIGN}${query}`)
  await expect(page.getByRole("heading", { level: 1, name: /Dentists within 5 mi/ })).toBeVisible()
}

const selected = (page: Page) => page.locator('[data-slot="lead-header"] h2')

for (const theme of ["light", "dark"] as const) {
  test.describe(`axe, ${theme} theme`, () => {
    test.use({ colorScheme: theme })

    test("review desk: draft, evidence and actions", async ({ page }) => {
      await desk(page)
      await expect(selected(page)).toHaveText("Sample Dental Studio")
      await expect(page.locator('[data-slot="email-text"], [data-slot="needs-review"]').first()).toBeVisible()
      await expectNoAxeViolations(page, `desk ${theme}`)
    })

    test("review desk: sending preview after approval", async ({ page }) => {
      await desk(page)
      await expect(selected(page)).toHaveText("Sample Dental Studio")
      await expect(page.locator('[data-slot="email-text"], [data-slot="needs-review"]').first()).toBeVisible()
      await page.keyboard.press("a")
      await expect(page.locator('[data-slot="sending-preview"]')).toBeVisible()
      // The Undo message is on screen too, so it is scanned as well.
      await expect(page.locator('[data-slot="toast"]')).toBeVisible()
      await expectNoAxeViolations(page, `sending preview ${theme}`)
    })

    test("sent screen", async ({ page }) => {
      await page.goto("/sent?status=all")
      await expect(page.locator("[data-sent-id]").first()).toBeVisible()
      await expectNoAxeViolations(page, `sent ${theme}`)
    })
  })
}

test.describe("axe, desk states", () => {
  test("needs review lead with Check and No source sentences", async ({ page }) => {
    await desk(page, "?view=needs_review")
    await expect(selected(page)).toHaveText("Sample Pediatric Dentistry")
      await expect(page.locator('[data-slot="email-text"], [data-slot="needs-review"]').first()).toBeVisible()
    await expect(page.locator('[data-slot="needs-review"]')).toBeVisible()
    await expectNoAxeViolations(page, "needs review")
  })

  test("approve warnings in place", async ({ page }) => {
    await desk(page, "?view=needs_review")
    await expect(selected(page)).toHaveText("Sample Pediatric Dentistry")
      await expect(page.locator('[data-slot="email-text"], [data-slot="needs-review"]').first()).toBeVisible()
    await page.keyboard.press("a")
    await expect(page.locator('[data-slot="approve-warnings"]')).toBeVisible()
    await expect(page.getByRole("button", { name: "Approve anyway" })).toBeVisible()
    await expectNoAxeViolations(page, "approve warnings")
  })

  test("research in progress", async ({ page }) => {
    await desk(page, "?view=in_progress")
    await page.getByRole("link", { name: /Sample Orthodontics/ }).click()
    await expect(page.getByText("Researching Sample Orthodontics")).toBeVisible()
    await expectNoAxeViolations(page, "in progress")
  })

  test("couldn't finish", async ({ page }) => {
    await desk(page, "?view=failed")
    await page.getByRole("link", { name: /Sample Dental Arts/ }).click()
    await expect(page.getByRole("button", { name: "Review without site facts" })).toBeVisible()
    await expectNoAxeViolations(page, "couldn't finish")
  })

  test("skip reasons, do-not-contact confirmation and edit mode", async ({ page }) => {
    await desk(page)
    await expect(selected(page)).toHaveText("Sample Dental Studio")
      await expect(page.locator('[data-slot="email-text"], [data-slot="needs-review"]').first()).toBeVisible()
    await page.keyboard.press("s")
    await expect(page.getByRole("group", { name: /why\?/ })).toBeVisible()
    await expectNoAxeViolations(page, "skip reasons")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+D")
    await expect(page.getByRole("button", { name: "Never contact Sample Dental Studio" })).toBeVisible()
    await expectNoAxeViolations(page, "dnc confirm")
    await page.keyboard.press("Escape")
    await page.keyboard.press("e")
    await expect(page.locator('[data-slot="email-editor"]')).toBeVisible()
    await expectNoAxeViolations(page, "edit mode")
  })

  test("show changes after a rewrite", async ({ page }) => {
    await desk(page)
    await expect(selected(page)).toHaveText("Sample Dental Studio")
      await expect(page.locator('[data-slot="email-text"], [data-slot="needs-review"]').first()).toBeVisible()
    await page.keyboard.press("1")
    await page.getByRole("button", { name: "Show changes" }).click({ timeout: 15_000 })
    await expect(page.locator('[data-slot="changes-view"]')).toBeVisible()
    await expectNoAxeViolations(page, "show changes")
  })

  test("hook menu, AI label and source preview", async ({ page }) => {
    await desk(page)
    await expect(selected(page)).toHaveText("Sample Dental Studio")
      await expect(page.locator('[data-slot="email-text"], [data-slot="needs-review"]').first()).toBeVisible()
    await page.getByRole("button", { name: /Hook:/ }).click()
    await expect(page.getByText("Chosen hook")).toBeVisible()
    await expectNoAxeViolations(page, "hook menu")
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: /AI draft/ }).click()
    await expect(page.getByText("How this draft was made")).toBeVisible()
    await expectNoAxeViolations(page, "AI label")
    await page.keyboard.press("Escape")
    await page.locator('[data-fact-id] a[data-kind="site"]').first().focus()
    await expect(page.locator('[data-slot="hover-card-content"]')).toBeVisible()
    await expectNoAxeViolations(page, "source preview")
  })

  test("phone: list, then a lead with the sticky bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await desk(page)
    await expectNoAxeViolations(page, "phone list")
    await page.getByRole("link", { name: /Sample Dental Studio/ }).click()
    await expect(page.locator('[data-slot="email-panel"]')).toBeVisible()
    await expectNoAxeViolations(page, "phone lead")
  })

  test("command menu and shortcut sheet", async ({ page }) => {
    await desk(page)
    await expect(selected(page)).toHaveText("Sample Dental Studio")
      await expect(page.locator('[data-slot="email-text"], [data-slot="needs-review"]').first()).toBeVisible()
    await page.keyboard.press("Control+k")
    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible()
    await expectNoAxeViolations(page, "command menu")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeHidden()
    await page.keyboard.press("?")
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible()
    await expectNoAxeViolations(page, "shortcut sheet")
  })

  test("sent screen on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/sent?status=sent")
    await expect(page.locator("[data-sent-id]").first()).toBeVisible()
    await expectNoAxeViolations(page, "sent phone")
  })
})
