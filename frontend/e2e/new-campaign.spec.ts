import { expect, test, type Page } from "@playwright/test"
import { apiRequest, devWorkspace } from "./accounts"
import { expectNoAxeViolations, usingRealBackend } from "./fixtures"

/*
 * New campaign (/campaigns/new): the brief, the AI's plan with at most one
 * question, and starting the run. Runs against the real backend
 * (backend/scripts/e2e_server.py: seeded Arlington, VA listings + fake AI).
 */

interface PlanBody {
  plan_id: string
  question: { text: string } | null
}

const BRIEF = {
  location: "Arlington, VA",
  radius_mi: 5,
  industry: "Dentists",
  offer_what: "Google Ads for dental practices",
  offer_proof: "Grew bookings 30% for a Fairfax practice",
  offer_cta: "Free 15-minute audit",
  tone: "professional",
  lead_target: 5,
}

/** Plans and starts a campaign through the API; returns its id and name. */
async function startCampaignViaApi(
  page: Page,
  overrides: Partial<typeof BRIEF> = {}
) {
  const input = { ...BRIEF, ...overrides }
  const plan = await apiRequest<PlanBody>(
    page,
    "POST",
    "/api/campaigns/plan",
    input
  )
  expect(plan.status, JSON.stringify(plan.body)).toBe(200)
  const created = await apiRequest<{ id: string; name: string }>(
    page,
    "POST",
    "/api/campaigns",
    {
      plan_id: plan.body.plan_id,
      input,
      answer: plan.body.question ? "no" : null,
    }
  )
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  return created.body
}

async function fillBrief(page: Page) {
  await page.getByRole("textbox", { name: "Who" }).fill(BRIEF.industry)
  await page.getByRole("textbox", { name: "Your offer" }).fill(BRIEF.offer_what)
  await page
    .getByRole("textbox", { name: "Proof (optional)" })
    .fill(BRIEF.offer_proof)
  await page.getByRole("textbox", { name: "Ask" }).fill(BRIEF.offer_cta)
  await page
    .getByRole("spinbutton", { name: "How many" })
    .fill(String(BRIEF.lead_target))
}

/** Types into Where and picks "Arlington, VA" with the arrow keys and Enter. */
async function pickArlington(page: Page) {
  const where = page.getByRole("combobox", { name: "Where" })
  await where.click()
  await where.pressSequentially("Arlin", { delay: 30 })
  const option = page.getByRole("option", { name: /^Arlington, VA/ })
  await expect(option).toBeVisible()
  await expect(where).toHaveAttribute("aria-expanded", "true")
  const optionId = await option.getAttribute("id")
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("ArrowDown")
    if ((await where.getAttribute("aria-activedescendant")) === optionId) break
  }
  await expect(where).toHaveAttribute("aria-activedescendant", optionId ?? "")
  await expect(option).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Enter")
  await expect(where).toHaveValue("Arlington, VA")
  await expect(where).toHaveAttribute("aria-expanded", "false")
}

async function reviewPlan(page: Page) {
  await page.getByRole("button", { name: "Review plan", exact: true }).click()
  const panel = page.getByTestId("plan-panel")
  await expect(panel).toContainText("Claude's plan:", { timeout: 20_000 })
  return panel
}

test.describe("new campaign", () => {
  test.skip(!usingRealBackend, "Needs the real backend (set E2E_BASE_URL)")

  test("plans with the keyboard and starts a campaign that opens on the review desk", async ({
    page,
  }) => {
    await devWorkspace(page, { tag: "nc-start", name: "Maya Chen" })
    await page.goto("/campaigns/new")
    await expect(
      page.getByRole("heading", { level: 1, name: "New campaign" })
    ).toBeVisible()
    await expect(
      page.getByText(
        "Maya Chen, Test Agency, 123 Example St, Arlington, VA 22201"
      )
    ).toBeVisible()

    await pickArlington(page)
    await fillBrief(page)
    const panel = await reviewPlan(page)
    await expect(panel).toContainText(
      "Dentists within 5 miles of Arlington, VA"
    )
    await expect(
      panel.getByRole("list", { name: "Listing categories" })
    ).toBeVisible()
    // Focus moves to the plan so it isn't missed.
    await expect(
      panel.getByRole("heading", { name: "Claude's plan:" })
    ).toBeFocused()

    const start = panel.getByRole("button", { name: /^Find 5 businesses/ })
    const question = panel.getByRole("radiogroup")
    if (await question.count()) {
      // Starting without an answer asks for one, in place.
      await start.click()
      await expect(
        panel.getByText("Choose Yes or No to continue.")
      ).toBeVisible()
      await expect(panel.getByRole("radio", { name: "Yes" })).toBeFocused()
      await panel.getByRole("radio", { name: "No" }).click()
      await expect(
        panel.getByText("Choose Yes or No to continue.")
      ).toBeHidden()
    }
    await expect(
      panel.getByText("First results in about 30 seconds")
    ).toBeVisible()
    await start.click()
    await expect(page).toHaveURL(/\/campaigns\/(?!new)[^/?#]+/, {
      timeout: 15_000,
    })
  })

  test("shows the server's place error next to Where and focuses it", async ({
    page,
  }) => {
    await devWorkspace(page, { tag: "nc-place" })
    await page.goto("/campaigns/new")
    const where = page.getByRole("combobox", { name: "Where" })
    await where.fill("Springfield")
    await fillBrief(page)
    await page.getByRole("button", { name: "Review plan", exact: true }).click()

    // The API's sentence ("We couldn't find that place…") or its short field note.
    const message = page
      .locator("form [data-slot=field-message]")
      .filter({ hasText: /couldn't find that place|Add the state/ })
    await expect(message).toBeVisible()
    await expect(where).toHaveAttribute("aria-invalid", "true")
    await expect(where).toBeFocused()
    const errorId = await message.getAttribute("id")
    expect(errorId).toBeTruthy()
    expect(await where.getAttribute("aria-describedby")).toContain(
      errorId ?? "missing"
    )
    await expect(page.getByTestId("plan-panel")).toHaveCount(0)

    // Fixing the place clears the message.
    await where.fill("Arlington, VA")
    await expect(message).toBeHidden()
  })

  test("checks the brief before asking for a plan and focuses the first problem", async ({
    page,
  }) => {
    await devWorkspace(page, { tag: "nc-empty" })
    await page.goto("/campaigns/new")
    await page.getByRole("button", { name: "Review plan", exact: true }).click()
    const where = page.getByRole("combobox", { name: "Where" })
    await expect(where).toBeFocused()
    await expect(
      page.getByText(
        'Enter a city and state, like "Arlington, VA", or a ZIP code.'
      )
    ).toBeVisible()
    await expect(
      page.getByText('Enter who you sell to, like "Dentists".')
    ).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Who" })).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    await expect(page.getByTestId("planning")).toHaveCount(0)
  })

  test("asks for a new review when the brief changes after the plan", async ({
    page,
  }) => {
    await devWorkspace(page, { tag: "nc-stale" })
    await page.goto("/campaigns/new")
    await page.getByRole("combobox", { name: "Where" }).fill("Arlington, VA")
    await fillBrief(page)
    const panel = await reviewPlan(page)
    await expect(
      panel.getByRole("button", { name: /^Find 5 businesses/ })
    ).toBeVisible()

    await page.getByRole("combobox", { name: "within" }).selectOption("10")
    await expect(
      panel.getByText("You changed the brief after this plan.")
    ).toBeVisible()
    await expect(panel.getByRole("button", { name: /^Find/ })).toHaveCount(0)

    await panel.getByRole("button", { name: "Review plan again" }).click()
    await expect(panel).toContainText(
      "Dentists within 10 miles of Arlington, VA",
      { timeout: 20_000 }
    )
    await expect(
      panel.getByRole("button", { name: /^Find 5 businesses/ })
    ).toBeVisible()
  })

  test("pre-fills the brief from the last campaign and picks a suggested industry", async ({
    page,
  }) => {
    await devWorkspace(page, { tag: "nc-prefill" })
    await startCampaignViaApi(page, {
      offer_what: "Websites for dental offices",
      tone: "friendly",
      lead_target: 6,
    })
    await page.goto("/campaigns/new")
    await expect(page.getByRole("combobox", { name: "Where" })).toHaveValue(
      "Arlington, VA"
    )
    await expect(page.getByRole("textbox", { name: "Who" })).toHaveValue(
      "Dentists"
    )
    await expect(page.getByRole("textbox", { name: "Your offer" })).toHaveValue(
      "Websites for dental offices"
    )
    await expect(page.getByRole("combobox", { name: "Tone" })).toHaveValue(
      "friendly"
    )
    await expect(
      page.getByRole("spinbutton", { name: "How many" })
    ).toHaveValue("6")

    const suggestions = page.getByRole("group", { name: "Suggestions:" })
    const chip = suggestions.getByRole("button", { name: "Dental Clinics" })
    await expect(chip).toHaveAttribute("aria-pressed", "false")
    await chip.click()
    await expect(page.getByRole("textbox", { name: "Who" })).toHaveValue(
      "Dental Clinics"
    )
    await expect(chip).toHaveAttribute("aria-pressed", "true")
  })

  test("has no axe violations, light and dark, with the plan shown", async ({
    page,
  }) => {
    await devWorkspace(page, { tag: "nc-axe" })
    await page.goto("/campaigns/new")
    await expect(
      page.getByRole("heading", { level: 1, name: "New campaign" })
    ).toBeVisible()
    await expectNoAxeViolations(page, "new campaign form, light")

    await page.getByRole("combobox", { name: "Where" }).fill("Arlington, VA")
    await fillBrief(page)
    await reviewPlan(page)
    await expectNoAxeViolations(page, "new campaign with plan, light")

    await page.emulateMedia({ colorScheme: "dark" })
    await expect(page.locator("html")).toHaveClass(/dark/)
    await expectNoAxeViolations(page, "new campaign with plan, dark")
  })
})
