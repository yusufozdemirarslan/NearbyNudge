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

  test("the One Step brand: a named home link, a decorative mark drawn exactly, and icons that load", async ({ page }) => {
    await page.goto("/sent")
    const home = page.getByRole("link", { name: "NearbyNudge, campaigns" })
    await expect(home).toBeVisible()
    const mark = home.locator('[data-slot="brand-mark"]')
    // Beside the readable name the mark is decorative, so the name isn't announced twice.
    await expect(mark).toHaveAttribute("aria-hidden", "true")
    await expect(mark).toHaveAttribute("viewBox", "0 0 16 16")
    const squares = await mark
      .locator("rect")
      .evaluateAll((rects) => rects.map((r) => ["x", "y", "width", "height"].map((a) => r.getAttribute(a)).join(",")))
    expect(squares).toEqual(["1,1,6,6", "9,9,6,6", "9,3,3,3"])
    await expect(home.locator(".brand-name")).toHaveText("NearbyNudge")
    const icons = await page
      .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
      .evaluateAll((links) => links.map((l) => l.getAttribute("href") ?? ""))
    expect(icons).toEqual([
      "/brand/nearbynudge/favicon.ico",
      "/brand/nearbynudge/favicon.svg",
      "/brand/nearbynudge/apple-touch-icon.png",
    ])
    for (const href of [...icons, "/favicon.ico", "/brand/nearbynudge/icon-light-16.png", "/brand/nearbynudge/icon-light-32.png"]) {
      const response = await page.request.get(href)
      expect(response.status(), href).toBe(200)
      expect(response.headers()["content-type"], href).toMatch(/^image\//)
    }
  })

  test("the mark's inks follow an explicit theme over the system's", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/sent")
    const inks = () =>
      page
        .locator('[data-slot="top-bar"] [data-slot="brand-mark"] rect')
        .evaluateAll((rects) => rects.map((r) => getComputedStyle(r).fill))
    await page.getByRole("button", { name: /Options menu/ }).click()
    await page.getByRole("menuitemradio", { name: "Light" }).click()
    await expect.poll(inks).toEqual(["rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(200, 16, 46)"])
    await page.getByRole("button", { name: /Options menu/ }).click()
    await page.getByRole("menuitemradio", { name: "Dark" }).click()
    await expect.poll(inks).toEqual(["rgb(255, 255, 255)", "rgb(255, 255, 255)", "rgb(255, 92, 97)"])
    // The browser's own bars follow the explicit choice too.
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#000000")
    await page.getByRole("button", { name: /Options menu/ }).click()
    await page.getByRole("menuitemradio", { name: "Match my computer" }).click()
    await expect.poll(inks).toEqual(["rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(200, 16, 46)"])
  })

  test("public pages carry the brand in the header and the footer", async ({ page }) => {
    await page.goto("/bot")
    const home = page.getByRole("link", { name: "NearbyNudge home" })
    await expect(home.locator('[data-slot="brand-mark"]')).toHaveAttribute("aria-hidden", "true")
    const footer = page.getByRole("contentinfo")
    await expect(footer.locator('[data-slot="brand"]')).toContainText("NearbyNudge")
    await expect(footer.locator('[data-slot="brand-mark"]')).toHaveAttribute("width", "16")
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
