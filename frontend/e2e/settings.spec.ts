import { expect, test } from "@playwright/test"
import { apiRequest, devWorkspace } from "./accounts"
import { expectNoAxeViolations, usingRealBackend } from "./fixtures"

/*
 * Settings against the real backend: preferences save, the sender profile
 * and its footer preview, and the section links. Each test uses its own
 * workspace. Delete all data is in no-sign-in.spec.ts.
 */

test.skip(!usingRealBackend, "Needs the real backend (set E2E_BASE_URL)")

interface AccountBody {
  preferences: { compact_rows: boolean; theme: string; webmail_mode: boolean }
}

test.describe("settings", () => {
  test("preferences save as they change and theme applies", async ({ page }) => {
    await devWorkspace(page, { tag: "prefs" })
    await page.goto("/settings")
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible()
    const section = page.locator("section#preferences")

    const compact = section.getByRole("switch", { name: "Compact rows" })
    await expect(compact).not.toBeChecked()
    await compact.click()
    await expect(compact).toBeChecked()
    await expect(section.getByText("Saved", { exact: true })).toBeVisible()

    const webmail = section.getByRole("switch", { name: /make Copy the main button/u })
    await webmail.click()
    await expect(webmail).toBeChecked()
    await expect(section.getByText("Saved", { exact: true })).toBeVisible()

    await section.getByRole("radio", { name: "Dark" }).click()
    await expect(page.locator("html")).toHaveClass(/dark/u)

    // Saved on the server, so they survive a reload.
    await expect
      .poll(async () => (await apiRequest<AccountBody>(page, "GET", "/api/account")).body.preferences)
      .toMatchObject({ compact_rows: true, webmail_mode: true, theme: "dark" })
    await page.reload()
    await expect(page.locator("section#preferences").getByRole("switch", { name: "Compact rows" })).toBeChecked()
    await expectNoAxeViolations(page, "settings (dark theme)")
  })

  test("sender profile shows a live footer preview and saves it", async ({ page }) => {
    await devWorkspace(page, { tag: "profile", name: "Maya Chen" })
    await page.goto("/settings#sender-profile")
    const section = page.locator("section#sender-profile")
    await expect(section.getByRole("heading", { level: 2, name: "Sender profile" })).toBeFocused()
    const preview = section.getByTestId("footer-preview")
    await expect(preview).toContainText("This email is a business offer from Test Agency.")

    await section.getByLabel("Company").fill("Brightline Ads")
    await section.getByLabel("Job title").fill("Founder")
    await expect(preview).toContainText("Founder, Brightline Ads")
    await expect(preview).toContainText("This email is a business offer from Brightline Ads.")
    await expect(section.getByText("Preview of your changes.", { exact: false })).toBeVisible()

    // The postal address is required (CAN-SPAM); the error is linked and focused.
    const address = section.getByLabel("Postal address")
    await address.fill("")
    await section.getByRole("button", { name: "Save sender profile" }).click()
    await expect(address).toBeFocused()
    await expect(address).toHaveAttribute("aria-invalid", "true")
    await expect(section.getByText("Enter your full postal address", { exact: false })).toBeVisible()

    await address.fill("123 Example St\nArlington, VA 22201")
    await section.getByRole("button", { name: "Save sender profile" }).click()
    await expect(section.getByText("Saved", { exact: true })).toBeVisible()
    await expect(preview).toContainText("Founder, Brightline Ads")
    await expect(preview).toContainText('Not interested? Reply "no thanks" and I won\'t email again.')
    const account = await apiRequest<{ footer_preview: string }>(page, "GET", "/api/account")
    expect(account.body.footer_preview).toContain("123 Example St\nArlington, VA 22201")
  })

  test("settings passes axe in light and dark, and section links move focus", async ({ page }) => {
    await devWorkspace(page, { tag: "settings-axe" })
    await page.goto("/settings")
    await expect(page.getByRole("heading", { level: 2, name: "Usage" })).toBeVisible()
    await expect(page.getByRole("meter", { name: /Leads drafted in/u })).toBeVisible()
    await expectNoAxeViolations(page, "settings (light)")
    const sections = page.getByRole("navigation", { name: "Settings sections" })
    await expect(sections.getByRole("link")).toHaveText(["Sender profile", "Preferences", "Usage", "Delete all data"])
    await sections.getByRole("link", { name: "Delete all data" }).click()
    await expect(page.getByRole("heading", { level: 2, name: "Delete all data" })).toBeFocused()
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
    await expectNoAxeViolations(page, "settings (dark)")
  })
})
