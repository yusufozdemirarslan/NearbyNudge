import { expect, expectNoAxeViolations, mockSettings, test, usingRealBackend } from "./fixtures"

const PAGES = [
  { link: "Campaigns", path: "/", heading: "Campaigns" },
  { link: "New campaign", path: "/campaigns/new", heading: "New campaign" },
  { link: "Sent", path: "/sent", heading: "Sent" },
  { link: "Numbers", path: "/numbers", heading: "Numbers" },
  { link: "Do not contact", path: "/dnc", heading: "Do not contact" },
  { link: "Settings", path: "/settings", heading: "Settings" },
  { link: "Admin", path: "/admin", heading: "Admin console" },
]

test.describe("app shell", () => {
  test("navigates with the sidebar and keeps one h1 per page", async ({ page }) => {
    await page.goto("/sent")
    const nav = page.getByRole("navigation", { name: "Main" })
    for (const target of PAGES) {
      await nav.getByRole("link", { name: target.link, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${target.path.replace(/\//g, "\\/")}$`))
      await expect(page.getByRole("heading", { level: 1, name: target.heading })).toBeVisible()
      await expect(nav.getByRole("link", { name: target.link, exact: true })).toHaveAttribute("aria-current", "page")
    }
  })

  test("skip link moves focus to the main content", async ({ page }) => {
    await page.goto("/sent")
    await expect(page.getByRole("heading", { level: 1, name: "Sent" })).toBeVisible()
    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "Skip to main content" })
    await expect(skip).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator("#main-content")).toBeFocused()
  })

  test("shows the sending meter in the top bar", async ({ page }) => {
    test.skip(usingRealBackend, "Uses the mock's starting count")
    await page.goto("/sent")
    const meter = page.locator('[data-slot="top-bar"]').getByRole("meter", { name: "Sent today" })
    await expect(meter).toHaveAttribute("aria-valuetext", "7 of 20")
  })

  test("command menu opens with Ctrl+K and navigates", async ({ page }) => {
    await page.goto("/sent")
    await expect(page.getByRole("heading", { level: 1, name: "Sent" })).toBeVisible()
    await page.keyboard.press("Control+k")
    const dialog = page.getByRole("dialog", { name: "Command menu" })
    await expect(dialog).toBeVisible()
    await page.keyboard.type("Numbers")
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(/\/numbers$/)
    await expect(dialog).toBeHidden()
  })

  test("shortcut sheet opens with ? and can turn single-key shortcuts off", async ({ page }) => {
    await page.goto("/sent")
    await expect(page.getByRole("heading", { level: 1, name: "Sent" })).toBeVisible()
    await page.keyboard.press("?")
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText("Open the command menu")).toBeVisible()
    const toggle = sheet.getByRole("switch", { name: "Single-key shortcuts" })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    // "?" is a single-key shortcut, so it no longer opens the sheet.
    await page.keyboard.press("?")
    await expect(sheet).toBeHidden()
    // Turn them back on from the options menu (the setting persists on a real backend).
    await page.getByRole("button", { name: /Options menu/ }).click()
    await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click()
    await sheet.getByRole("switch", { name: "Single-key shortcuts" }).click()
    await expect(sheet.getByRole("switch", { name: "Single-key shortcuts" })).toBeChecked()
    await page.keyboard.press("Escape")
  })

  test("theme follows the saved preference", async ({ page }) => {
    await page.goto("/sent")
    await page.getByRole("button", { name: /Options menu/ }).click()
    await page.getByRole("menuitemradio", { name: "Dark" }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.getByRole("button", { name: /Options menu/ }).click()
    await page.getByRole("menuitemradio", { name: "Light" }).click()
    await expect(page.locator("html")).not.toHaveClass(/dark/)
  })

  test("paused banner appears while research is paused", async ({ page }) => {
    test.skip(usingRealBackend, "Needs the mock's pause control")
    await mockSettings(page, { "nn-mock-paused": "1" })
    await page.goto("/sent")
    await expect(page.getByText("Research paused. We'll resume automatically, and nothing is lost.")).toBeVisible()
  })

  test("shell has no axe violations", async ({ page }) => {
    await page.goto("/sent")
    await expect(page.getByRole("heading", { level: 1, name: "Sent" })).toBeVisible()
    await expectNoAxeViolations(page, "shell on /sent")
  })
})
