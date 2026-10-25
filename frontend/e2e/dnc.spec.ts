import { readFile } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"
import { apiRequest, devWorkspace } from "./accounts"
import { expectNoAxeViolations, usingRealBackend } from "./fixtures"

interface Entry {
  id: string
  business_name: string | null
  domain: string | null
  email: string | null
  reason: string | null
}

async function seed(page: Page, entries: Partial<Entry>[]) {
  for (const entry of entries) {
    const { status } = await apiRequest(page, "POST", "/api/dnc", entry)
    expect(status).toBe(200)
  }
}

async function serverList(page: Page): Promise<Entry[]> {
  const { body } = await apiRequest<Entry[]>(page, "GET", "/api/dnc")
  return body
}

const listOf = (page: Page) => page.getByRole("list", { name: "On your list" })
const rowFor = (page: Page, text: string) =>
  listOf(page).getByTestId("dnc-row").filter({ hasText: text })

test.describe("do not contact", () => {
  test.skip(!usingRealBackend, "Needs the real backend (set E2E_BASE_URL)")

  test.beforeEach(async ({ page }) => {
    await devWorkspace(page, { tag: "dnc" })
  })

  test("adds a business, a website and an email, then searches", async ({
    page,
  }) => {
    await page.goto("/dnc")
    await expect(
      page.getByRole("heading", { level: 1, name: "Do not contact" })
    ).toBeVisible()
    await expect(
      page.getByText("NearbyNudge checks this list before drafting every email")
    ).toBeVisible()
    await expect(page.getByText("Your list is empty")).toBeVisible()
    await expectNoAxeViolations(page, "/dnc empty")

    const form = page.getByRole("form", {
      name: "Add to the Do not contact list",
    })
    const add = form.getByRole("button", { name: "Add to list" })
    const name = form.getByRole("textbox", { name: "Business name" })
    const website = form.getByRole("textbox", { name: "Website" })
    const email = form.getByRole("textbox", { name: "Email" })

    // Nothing filled in: one message for the group, linked to all three fields.
    await add.click()
    await expect(name).toBeFocused()
    for (const field of [name, website, email]) {
      await expect(field).toHaveAttribute("aria-invalid", "true")
      await expect(field).toHaveAccessibleDescription(
        /Add a business name, a website or an email address./
      )
    }
    await expectNoAxeViolations(page, "/dnc group error")

    await name.fill("Harbor Family Dentistry")
    await expect(name).not.toHaveAttribute("aria-invalid", "true")
    await form.getByRole("textbox", { name: /Reason/ }).fill("Already a client")
    await add.click()
    await expect(form.getByText("Added Harbor Family Dentistry.")).toBeVisible()
    await expect(rowFor(page, "Harbor Family Dentistry")).toContainText(
      "Reason: Already a client"
    )
    await expect(rowFor(page, "Harbor Family Dentistry")).toContainText("You")
    await expect(name).toBeFocused()

    // A full address is kept as its website domain.
    await website.fill("https://www.lakeside-smiles.example/contact")
    await add.click()
    await expect(rowFor(page, "lakeside-smiles.example")).toBeVisible()

    await email.fill("front desk@")
    await add.click()
    await expect(
      form.getByText("Enter an email address, such as name@example.com.")
    ).toBeVisible()
    await expect(email).toBeFocused()
    await email.fill("frontdesk@courthouse-dental.example")
    await add.click()
    await expect(
      rowFor(page, "frontdesk@courthouse-dental.example")
    ).toBeVisible()
    await expect(page.getByText("3 entries on your list")).toBeVisible()
    expect((await serverList(page)).length).toBe(3)

    // Search narrows the list, and says so.
    const search = page.getByRole("searchbox", { name: "Search the list" })
    await search.fill("harbor")
    await expect(page.getByText("1 match for “harbor”")).toBeVisible()
    await expect(listOf(page).getByTestId("dnc-row")).toHaveCount(1)
    await expect(page.getByTestId("announcer")).toHaveText("1 match for harbor")

    await search.fill("zzzz")
    await expect(page.getByText("Nothing matches “zzzz”")).toBeVisible()
    await page.getByRole("button", { name: "Clear search" }).first().click()
    await expect(listOf(page).getByTestId("dnc-row")).toHaveCount(3)
    await expectNoAxeViolations(page, "/dnc with entries")
  })

  test("removing keeps Undo on the row and in a message", async ({ page }) => {
    await seed(page, [
      { business_name: "Ballston Pediatric Dentistry", reason: "Not a fit" },
      { domain: "clarendon-ortho.example" },
    ])
    await page.goto("/dnc")
    await rowFor(page, "Ballston Pediatric Dentistry")
      .getByRole("button", { name: "Remove Ballston Pediatric Dentistry" })
      .click()

    const removedRow = page.getByTestId("dnc-removed-row")
    await expect(removedRow).toContainText(
      "Removed Ballston Pediatric Dentistry"
    )
    const rowUndo = removedRow.getByRole("button", {
      name: "Undo removing Ballston Pediatric Dentistry",
    })
    await expect(rowUndo).toBeFocused()
    const toast = page
      .locator('[data-slot="toast"]')
      .filter({ hasText: "Removed Ballston Pediatric Dentistry" })
    await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible()
    expect(
      (await serverList(page)).map((entry) => entry.business_name)
    ).not.toContain("Ballston Pediatric Dentistry")
    await expectNoAxeViolations(page, "/dnc removed row")

    // Undo on the row puts it back (with its reason) and closes the message.
    await rowUndo.click()
    await expect(rowFor(page, "Ballston Pediatric Dentistry")).toContainText(
      "Reason: Not a fit"
    )
    await expect(removedRow).toHaveCount(0)
    await expect(toast).toHaveCount(0)
    expect(
      (await serverList(page)).map((entry) => entry.business_name)
    ).toContain("Ballston Pediatric Dentistry")

    // Remove again, and undo from the message this time.
    await rowFor(page, "Ballston Pediatric Dentistry")
      .getByRole("button", { name: "Remove Ballston Pediatric Dentistry" })
      .click()
    await expect(removedRow).toBeVisible()
    await toast.getByRole("button", { name: "Undo" }).click()
    await expect(rowFor(page, "Ballston Pediatric Dentistry")).toBeVisible()
    await expect(removedRow).toHaveCount(0)
    expect(
      (await serverList(page)).map((entry) => entry.business_name)
    ).toContain("Ballston Pediatric Dentistry")
  })

  test("exports the list as a CSV file", async ({ page }) => {
    await seed(page, [
      { email: "owner@export-test.example", reason: "Asked us not to email" },
    ])
    await page.goto("/dnc")
    await expect(rowFor(page, "owner@export-test.example")).toBeVisible()
    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("button", { name: "Export CSV" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe("do-not-contact.csv")
    const text = await readFile(await download.path(), "utf8")
    expect(text).toContain(
      "Business,Website domain,Email,Reason,Added by,Added"
    )
    expect(text).toContain("owner@export-test.example")
    await expect(page.getByTestId("announcer")).toHaveText(
      "Downloaded do-not-contact.csv"
    )
  })

  test("has no axe violations in dark mode", async ({ page }) => {
    await seed(page, [
      {
        business_name: "Courthouse Dental Arts",
        domain: "courthousedental.example",
        email: "hello@courthousedental.example",
        reason: "Owner asked",
      },
      { domain: "rosslyn-smiles.example" },
    ])
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto("/dnc")
    await expect(page.locator("html")).toHaveClass(/dark/)
    await expect(rowFor(page, "Courthouse Dental Arts")).toBeVisible()
    await expectNoAxeViolations(page, "/dnc dark")
  })
})
