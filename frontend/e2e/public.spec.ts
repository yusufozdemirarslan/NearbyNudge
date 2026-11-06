import { expect, test } from "@playwright/test"
import { expectNoAxeViolations, usingRealBackend } from "./fixtures"

const PAGES = [
  { path: "/bot", heading: "NearbyNudgeBot" },
  { path: "/data-sources", heading: "Data sources" },
  { path: "/terms", heading: "Terms of use" },
  { path: "/privacy", heading: "Privacy" },
]

test.describe("public pages", () => {
  for (const target of PAGES) {
    test(`${target.path} reads well, with a way to the app`, async ({ page }) => {
      await page.goto(target.path)
      await expect(
        page.getByRole("heading", { level: 1, name: target.heading })
      ).toBeVisible()
      await expect(page.locator("h1")).toHaveCount(1)
      // No sign-in: the header leads straight to the app.
      await expect(
        page.getByRole("banner").getByRole("link", { name: "Go to campaigns" })
      ).toHaveAttribute("href", "/")
      await expect(page.getByText(/sign in/iu)).toHaveCount(0)
      await expect(
        page.getByRole("navigation", { name: "About NearbyNudge" })
      ).toBeVisible()
      await expectNoAxeViolations(page, target.path)
    })
  }

  test("/bot has no axe violations in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto("/bot")
    await expect(page.locator("html")).toHaveClass(/dark/)
    await expect(
      page.getByRole("heading", { level: 1, name: "NearbyNudgeBot" })
    ).toBeVisible()
    await expectNoAxeViolations(page, "/bot dark")
  })

  test("/bot names the user agent and the robots.txt lines", async ({
    page,
  }) => {
    await page.goto("/bot")
    const origin = new URL(page.url()).origin
    await expect(
      page.getByText(`NearbyNudgeBot/2.0 (+${origin}/bot)`)
    ).toBeVisible()
    await expect(page.getByText("User-agent: NearbyNudgeBot")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Copy user agent" })
    ).toBeVisible()
  })

  test("/data-sources and /privacy name the AI and its provider", async ({
    page,
  }) => {
    await page.goto("/data-sources")
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "The AI: Claude Sonnet 5.5 by Anthropic",
      })
    ).toBeVisible()
    await expect(
      page.getByRole("rowheader", { name: "trafilatura" })
    ).toBeVisible()
    // Sign-in was removed, and so was its passkey library.
    await expect(
      page.getByRole("rowheader", { name: "py_webauthn" })
    ).toHaveCount(0)
    await page.goto("/privacy")
    await expect(
      page.getByText(
        "Anthropic does not use data sent through its API to train its models by default."
      )
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Delete all data in Settings" })
    ).toHaveAttribute("href", "/settings#delete-data")
    await expect(page.getByText("Each copy of NearbyNudge has one account, protected by a password", { exact: false })).toBeVisible()
  })

  test("the opt-out form explains what to fix, next to each field", async ({
    page,
  }) => {
    await page.goto("/bot")
    const form = page.getByRole("form", { name: "Opt-out request" })
    const website = form.getByRole("textbox", { name: "Your website" })
    const email = form.getByRole("textbox", { name: "Your email" })
    const submit = form.getByRole("button", { name: "Send opt-out request" })

    await submit.click()
    await expect(website).toBeFocused()
    await expect(website).toHaveAttribute("aria-invalid", "true")
    await expect(website).toHaveAccessibleDescription(
      /Enter your website's address, such as example.com./
    )
    await expect(email).toHaveAccessibleDescription(
      /Enter an email address we can reach you at./
    )

    await website.fill("not a website")
    await email.fill("owner@")
    await submit.click()
    await expect(
      form.getByText("Enter a website address, such as example.com.")
    ).toBeVisible()
    await expect(
      form.getByText("Enter an email address, such as you@example.com.")
    ).toBeVisible()
    await expect(website).toBeFocused()
    await expectNoAxeViolations(page, "/bot opt-out errors")
  })

  test("site owners can opt out and see the server's confirmation", async ({
    page,
  }) => {
    test.skip(!usingRealBackend, "Submits to the real backend")
    await page.goto("/bot")
    const form = page.getByRole("form", { name: "Opt-out request" })
    const domain = `optout-${Date.now().toString(36)}.example`
    await form
      .getByRole("textbox", { name: "Your website" })
      .fill(`https://www.${domain}/contact`)
    await form
      .getByRole("textbox", { name: "Your email" })
      .fill(`owner@${domain}`)
    await form
      .getByRole("textbox", { name: /Anything we should know/ })
      .fill("Please stop reading our site.")
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/public/optout")
    )
    await form.getByRole("button", { name: "Send opt-out request" }).click()
    const response = await responsePromise

    if (response.status() === 429) {
      // Opt-outs are limited to 5 an hour per address; earlier runs may have used them up.
      await expect(
        page.getByText("We couldn't take another request yet")
      ).toBeVisible()
      await expect(
        page.getByText("The robots.txt lines above work without waiting.")
      ).toBeVisible()
      test.info().annotations.push({
        type: "note",
        description: "Rate limited; checked the calm message instead.",
      })
      return
    }

    expect(response.status()).toBe(200)
    const { message } = (await response.json()) as { message: string }
    const confirmation = page.getByTestId("optout-confirmation")
    await expect(
      confirmation.getByRole("heading", {
        name: `Request received for ${domain}`,
      })
    ).toBeFocused()
    await expect(confirmation.getByText(message)).toBeVisible()
    await expectNoAxeViolations(page, "/bot opt-out confirmation")

    await confirmation
      .getByRole("button", { name: "Send another request" })
      .click()
    await expect(
      page.getByRole("textbox", { name: "Your website" })
    ).toBeFocused()
    await expect(
      page.getByRole("textbox", { name: "Your website" })
    ).toHaveValue("")
  })
})
