import { apiRequest, devWorkspace } from "./accounts"
import { expect, expectNoAxeViolations, mockSettings, test, usingRealBackend } from "./fixtures"

/*
 * Without a password set (the sample data, the test server, this computer by
 * default) NearbyNudge asks for no sign-in: everyone who opens it uses one
 * workspace. These run on the sample data and on the real backend (where each
 * test that changes the workspace takes its own through POST /api/dev/workspace).
 * The sign-in itself is in login.spec.ts.
 */

/** The address of the campaigns home, with no path or query after it. */
const HOME = /^[a-z]+:\/\/[^/]+\/$/u

test.describe("with sign-in off", () => {
  test("the app opens straight to campaigns, with no sign-in anywhere", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1, name: "Campaigns" })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" })).toBeVisible()
    await expect(page.getByText(/sign (in|out|up)/iu)).toHaveCount(0)

    // The sidebar footer names the sender and offers settings, not a sign-out.
    const menu = page.getByRole("button", { name: /Options menu/u })
    await expect(menu).toContainText(usingRealBackend ? "Test Sender" : "Maya Chen")
    await menu.click()
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: /sign out/iu })).toHaveCount(0)
    await page.keyboard.press("Escape")

    if (usingRealBackend) {
      const me = await apiRequest<{ user: { onboarded: boolean; name: string } }>(page, "GET", "/api/me")
      expect(me.status).toBe(200)
      expect(me.body.user).toMatchObject({ onboarded: true, name: "Test Sender" })
      expect((await apiRequest(page, "GET", "/api/auth/session")).body).toEqual({ enabled: false, signed_in: true, email: null })
      // The old passkey endpoints are gone.
      expect((await apiRequest(page, "GET", "/api/auth/me")).status).toBe(404)
      expect((await apiRequest(page, "POST", "/api/auth/login/options", {})).status).toBe(404)
    }
  })

  test("the sign-in page and old sign-in and sign-up links open the app", async ({ page }) => {
    const paths = ["/login", "/login?redirect=https%3A%2F%2Fevil.example%2F", "/login?redirect=%2F%2Fevil.example",
      "/signin", "/signin?redirect=%2Fsent", "/signup?invite=NN-245U-YXYG", "/recover"]
    for (const path of paths) {
      await page.goto(path)
      await expect(page, path).toHaveURL(HOME)
      await expect(page.getByRole("heading", { level: 1, name: "Campaigns" })).toBeVisible()
    }
    // A page the browser was on its way to comes next.
    await page.goto("/login?redirect=%2Fsent%3Fstatus%3Dall")
    await expect(page).toHaveURL(/\/sent\?status=all$/u)
    await expect(page.getByRole("heading", { level: 1, name: "Sent" })).toBeVisible()
  })

  test("a new workspace sets up its sender profile once, then lands on New campaign", async ({ page }) => {
    if (usingRealBackend) await devWorkspace(page, { tag: "fresh", onboarded: false })
    else await mockSettings(page, { "nn-mock-onboarded": "0" })

    // Every page leads to the one-time set-up until the profile exists.
    await page.goto("/sent")
    await expect(page).toHaveURL(/\/onboarding$/u)
    await expect(page.getByRole("heading", { level: 1, name: "Set up your sender profile" })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0)

    // The footer preview follows the fields; the address is required.
    const name = page.getByLabel("Your name")
    await expect(name).toBeFocused()
    await expect(name).toHaveValue("")
    const timezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    await expect(page.getByLabel("Time zone")).toHaveValue(timezone)
    const preview = page.getByTestId("footer-preview")
    await expect(preview).toContainText("Your postal address")
    await name.fill("Maya Chen")
    await page.getByLabel("Company").fill("Brightline Ads")
    await page.getByRole("button", { name: "Save and set up a campaign" }).click()
    const address = page.getByLabel("Postal address")
    await expect(address).toBeFocused()
    await expect(address).toHaveAttribute("aria-invalid", "true")
    await expect(page.getByText("Enter your full postal address", { exact: false })).toBeVisible()
    await address.fill("123 Example St\nArlington, VA 22201")
    await expect(preview).toContainText("Maya Chen")
    await expect(preview).toContainText("123 Example St")
    await expect(preview).toContainText("This email is a business offer from Brightline Ads.")
    await page.getByRole("radio", { name: /Friendly/u }).click()
    await expectNoAxeViolations(page, "sender profile set-up")
    await page.getByRole("button", { name: "Save and set up a campaign" }).click()

    await expect(page).toHaveURL(/\/campaigns\/new$/u)
    await expect(page.getByRole("heading", { level: 1, name: "New campaign" })).toBeVisible()
    await expect(page.getByText("Maya Chen, Brightline Ads", { exact: false })).toBeVisible()
    await expect(page.getByRole("button", { name: /Options menu/u })).toContainText("Brightline Ads")

    if (usingRealBackend) {
      // A first campaign takes the profile's tone (the sample data pre-fills from its last campaign).
      await expect(page.getByLabel("Tone")).toHaveValue("friendly")
      const me = await apiRequest<{ user: { onboarded: boolean; name: string } }>(page, "GET", "/api/me")
      expect(me.body.user).toMatchObject({ onboarded: true, name: "Maya Chen" })
      // It never shows again.
      await page.goto("/onboarding")
      await expect(page).toHaveURL(HOME)
    }
  })

  test("Delete all data needs the word typed, then starts over at the set-up", async ({ page }) => {
    let workspaceId = ""
    if (usingRealBackend) {
      workspaceId = (await devWorkspace(page, { tag: "delete" })).id
      const added = await apiRequest(page, "POST", "/api/dnc", { business_name: "Sample Courthouse Dental" })
      expect(added.status, JSON.stringify(added.body)).toBe(200)
    }
    await page.goto("/settings#delete-data")
    const section = page.locator("section#delete-data")
    await expect(section.getByRole("heading", { level: 2, name: "Delete all data" })).toBeFocused()
    const confirm = section.getByLabel("Type delete to confirm")
    const button = section.getByRole("button", { name: "Delete all data" })

    await confirm.fill("remove everything")
    await button.click()
    await expect(confirm).toBeFocused()
    await expect(confirm).toHaveAttribute("aria-invalid", "true")
    await expect(section.getByText("Type delete to confirm.", { exact: true })).toBeVisible()
    await expectNoAxeViolations(page, "delete all data, wrong word")

    await confirm.fill(" DELETE ")
    await button.click()
    await expect(page).toHaveURL(/\/onboarding$/u)
    await expect(page.getByRole("heading", { level: 1, name: "Set up your sender profile" })).toBeVisible()
    await expect(page.getByText("All data deleted", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Your name")).toHaveValue("")

    if (usingRealBackend) {
      const me = await apiRequest<{ user: { id: string; onboarded: boolean } }>(page, "GET", "/api/me")
      expect(me.body.user).toMatchObject({ id: workspaceId, onboarded: false })
      expect((await apiRequest<unknown[]>(page, "GET", "/api/dnc")).body).toEqual([])
      expect((await apiRequest<unknown[]>(page, "GET", "/api/campaigns")).body).toEqual([])
    }
  })
})
