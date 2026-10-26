#!/usr/bin/env node
/**
 * Design review screenshots for NearbyNudge.
 *
 *   node design-review/shoot.mjs before             every screen -> design-review/before/
 *   node design-review/shoot.mjs after desk sent    just these screens -> design-review/after/
 *   node design-review/shoot.mjs list               the screen names
 *
 * Safety: the script starts its own dashboard in sample-data mode (`vite --mode mock`:
 * an in-memory copy of the sample campaign, no backend) on its own port, and only ever
 * visits that. Nothing it types or clicks reaches a server, a database or a real
 * business, and the sample data is thrown away when it exits. It never connects to the
 * real app on port 8000.
 *
 * Every screen is shot at 1440px (desktop) and 390px (phone) wide once its data and
 * fonts have loaded, as a full-page PNG. App screens whose panes scroll on their own
 * (the review desk) are shot at window size instead, because that is how they are used.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")
const FRONTEND = path.join(ROOT, "frontend")
const require = createRequire(path.join(FRONTEND, "package.json"))
const { chromium } = require("@playwright/test")
const VITE = path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js")

const PORT = Number(process.env.DESIGN_REVIEW_PORT ?? 5310)
const BASE = `http://127.0.0.1:${PORT}`

const SIZES = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
]

/** The mock's sample campaign: "Dentists within 5 mi of Arlington, VA". */
const CAMPAIGN = "/campaigns/c1"

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

const h1 = (page, name) => page.getByRole("heading", { level: 1, name }).first().waitFor()
const shown = (page, selector) => page.locator(selector).first().waitFor()

/** On a phone the desk opens on the list; tap a lead to see its email. */
async function openSampleLead(page, size) {
  if (size.mobile) await page.getByRole("link", { name: /Sample Dental Studio/ }).first().click()
  await shown(page, '[data-slot="email-text"]')
}

/** Opens a page from the main navigation (on phones it lives behind the Menu button). */
async function openFromNav(page, size, name) {
  if (size.mobile) {
    // The menu button was "Show or hide navigation" before the redesign.
    const menu = page.getByRole("button", { name: /^(Menu|Show or hide navigation)$/ })
    await menu.click()
  }
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true }).click()
}

/**
 * Empties the sample workspace the way a person would (Settings, Delete all data), then
 * saves a sender profile. All of it happens in the sample data held in browser memory.
 */
async function emptyWorkspace(page) {
  await page.getByLabel("Type delete to confirm").fill("delete")
  await page.getByRole("button", { name: "Delete all data" }).click()
  await h1(page, "Set up your sender profile")
  await page.getByLabel("Your name", { exact: true }).fill("Maya Chen")
  await page.getByLabel("Company", { exact: true }).fill("Brightline Ads")
  await page.getByLabel("Postal address", { exact: true }).fill("123 Example St, Arlington, VA 22201")
  await page.getByRole("button", { name: "Save and set up a campaign" }).click()
  await h1(page, "New campaign")
}

/** An empty-workspace screen: start from Settings, empty it, then open `navName`. */
function emptyScreen(name, navName, readyText) {
  return {
    name,
    path: "/settings#delete-data",
    ready: (p) => h1(p, "Settings"),
    prepare: async (p, size) => {
      await emptyWorkspace(p)
      await openFromNav(p, size, navName)
      await p.getByText(readyText).first().waitFor()
    },
  }
}

/**
 * name      file name prefix
 * path      where to go
 * settings  mock controls written to localStorage before the app loads
 * ready     resolves when the screen has its data
 * prepare   clicks or keys that reach a state (sample data only)
 * window    shoot the window instead of the full page
 * dark      also shoot it in dark mode
 * only      "desktop" or "mobile" when the state only exists at one size
 */
const SCREENS = [
  { name: "onboarding", path: "/onboarding", settings: { "nn-mock-onboarded": "0" }, ready: (p) => h1(p), dark: true },
  { name: "campaigns", path: "/", ready: (p) => h1(p, "Campaigns"), dark: true },
  { name: "campaigns-paused", path: "/", settings: { "nn-mock-paused": "1" }, ready: (p) => h1(p, "Campaigns") },
  {
    name: "command-menu",
    path: "/",
    ready: (p) => h1(p, "Campaigns"),
    prepare: async (p) => {
      await p.keyboard.press("Control+k")
      await shown(p, '[role="dialog"]')
    },
    window: true,
    only: "desktop",
  },
  emptyScreen("campaigns-empty", "Campaigns", "Start your first campaign"),
  { name: "new-campaign", path: "/campaigns/new", ready: (p) => h1(p) },
  {
    name: "new-campaign-plan",
    path: "/campaigns/new",
    ready: (p) => h1(p),
    prepare: async (p) => {
      await p.getByRole("button", { name: "Review plan", exact: true }).click()
      await shown(p, '[data-testid="plan-panel"]')
    },
  },
  {
    name: "desk",
    path: CAMPAIGN,
    ready: (p, size) => (size.mobile ? h1(p) : shown(p, '[data-slot="email-text"]')),
    window: true,
    dark: true,
  },
  { name: "desk-lead", path: CAMPAIGN, ready: (p) => h1(p), prepare: openSampleLead, window: true, only: "mobile" },
  {
    name: "desk-needs-review",
    path: `${CAMPAIGN}?view=needs_review`,
    ready: (p) => shown(p, '[data-slot="email-text"]'),
    window: true,
    only: "desktop",
  },
  {
    name: "desk-researching",
    path: `${CAMPAIGN}?view=in_progress&lead=lsq`,
    ready: (p) => p.getByText("Researching Sample Orthodontics").first().waitFor(),
    window: true,
    only: "desktop",
  },
  {
    name: "desk-failed",
    path: `${CAMPAIGN}?view=failed&lead=lsp`,
    ready: (p) => p.getByRole("button", { name: /Review without site facts/ }).first().waitFor(),
    window: true,
    only: "desktop",
  },
  { name: "desk-finished", path: "/campaigns/c2", ready: (p) => h1(p, /HVAC/), window: true, only: "desktop" },
  {
    name: "desk-sending-preview",
    path: CAMPAIGN,
    ready: (p) => h1(p),
    prepare: async (p, size) => {
      await openSampleLead(p, size)
      await p.keyboard.press("a")
      await shown(p, '[data-slot="sending-preview"]')
    },
    window: true,
  },
  {
    name: "desk-at-cap",
    path: CAMPAIGN,
    settings: { "nn-mock-sent-today": "20" },
    ready: (p) => h1(p),
    prepare: async (p, size) => {
      await openSampleLead(p, size)
      await p.keyboard.press("a")
      await shown(p, '[data-slot="sending-preview"]')
    },
    window: true,
    only: "desktop",
  },
  {
    name: "desk-skip",
    path: CAMPAIGN,
    ready: (p) => h1(p),
    prepare: async (p, size) => {
      await openSampleLead(p, size)
      await p.keyboard.press("s")
      await p.waitForTimeout(300)
    },
    window: true,
    only: "desktop",
  },
  {
    name: "shortcuts",
    path: CAMPAIGN,
    ready: (p) => shown(p, '[data-slot="email-text"]'),
    prepare: async (p) => {
      await p.keyboard.press("Shift+Slash")
      await shown(p, '[role="dialog"]')
    },
    window: true,
    only: "desktop",
  },
  { name: "sent", path: "/sent?status=all", ready: (p) => shown(p, "[data-sent-id]"), dark: true },
  emptyScreen("sent-empty", "Sent", "Nothing approved yet"),
  { name: "numbers", path: "/numbers", ready: (p) => h1(p), dark: true },
  emptyScreen("numbers-empty", "Numbers", "No numbers yet"),
  { name: "dnc", path: "/dnc", ready: (p) => h1(p) },
  emptyScreen("dnc-empty", "Do not contact", "Your list is empty"),
  { name: "settings", path: "/settings", ready: (p) => h1(p) },
  { name: "admin", path: "/admin", ready: (p) => h1(p) },
  { name: "bot", path: "/bot", ready: (p) => h1(p) },
  { name: "data-sources", path: "/data-sources", ready: (p) => h1(p) },
  { name: "privacy", path: "/privacy", ready: (p) => h1(p) },
  { name: "terms", path: "/terms", ready: (p) => h1(p) },
  { name: "not-found", path: "/this-page-does-not-exist", ready: (p) => p.getByText("We couldn't find that page").waitFor() },
]

// ---------------------------------------------------------------------------
// Flows: click through a screen's jobs on the sample data and check each step
// lands. `node design-review/shoot.mjs flows desk` saves every step to after/flows/.
// ---------------------------------------------------------------------------

const visible = (page, selector) => page.locator(selector).first().waitFor({ state: "visible" })
const gone = (page, selector) => page.locator(selector).first().waitFor({ state: "hidden" })
/** Waits until the masthead's "Sent today" meter reads `text` (e.g. "8 of 20"). */
const sentToday = (page, text) =>
  page.waitForFunction(
    (value) => document.querySelector('[data-slot="top-bar"] [role="meter"]')?.getAttribute("aria-valuetext") === value,
    text,
    { timeout: 10_000 }
  )
const rowStatus = (page, name) =>
  page.locator("li[data-lead-id]").filter({ hasText: name }).first().locator('[data-slot="status-badge"]').first()

/** Each flow is a list of [step name, action]. An action throws when the step doesn't land. */
const FLOWS = {
  campaigns: [
    ["open", async (p) => {
      await p.goto("/")
      await p.getByRole("heading", { level: 1, name: "Campaigns" }).waitFor()
    }],
    ["open a finished campaign", async (p) => {
      await p.getByRole("link", { name: "HVAC within 10 mi of Fairfax, VA" }).click()
      await p.getByRole("heading", { level: 1, name: /HVAC within 10 mi/ }).waitFor()
    }],
    ["back to campaigns from the masthead", async (p) => {
      await p.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Campaigns", exact: true }).click()
      await p.getByRole("heading", { level: 1, name: "Campaigns" }).waitFor()
    }],
    ["start a new campaign", async (p) => {
      await p.getByRole("link", { name: "New campaign" }).first().click()
      await p.getByRole("heading", { level: 1, name: "New campaign" }).waitFor()
    }],
  ],
  "new-campaign": [
    ["open", async (p) => {
      await p.goto("/campaigns/new")
      await p.getByRole("heading", { level: 1, name: "New campaign" }).waitFor()
    }],
    ["an empty Who is caught on Review plan", async (p) => {
      await p.getByRole("textbox", { name: "Who" }).fill("")
      await p.getByRole("button", { name: "Review plan", exact: true }).click()
      await p.getByText('Enter who you sell to, like "Dentists".').waitFor()
    }],
    ["a suggestion fills Who and shows as pressed", async (p) => {
      const group = p.getByRole("group", { name: "Suggestions:" })
      await group.getByRole("button", { name: "Dentists" }).click()
      await group.locator('[aria-pressed="true"]', { hasText: "Dentists" }).waitFor()
      if ((await p.getByRole("textbox", { name: "Who" }).inputValue()) !== "Dentists") throw new Error("Who was not filled")
    }],
    ["Review plan shows the plan with its heading focused", async (p) => {
      await p.getByRole("button", { name: "Review plan", exact: true }).click()
      await visible(p, '[data-testid="plan-panel"]')
      await p.waitForFunction(() => document.activeElement?.textContent?.endsWith("plan:"))
    }],
    ["changing the brief marks the plan as stale", async (p) => {
      await p.getByRole("textbox", { name: "Your offer" }).fill("Google Ads for dental and orthodontic practices")
      await p.getByText("You changed the brief after this plan.").waitFor()
    }],
    ["Review plan again clears it", async (p) => {
      await p.getByRole("button", { name: "Review plan again" }).first().click()
      await gone(p, "text=You changed the brief after this plan.")
      await visible(p, '[data-testid="plan-panel"]')
    }],
    ["Find asks the plan's question first", async (p) => {
      await p.getByRole("button", { name: /^Find \d+ businesses/ }).click()
      await p.getByText("Choose Yes or No to continue.").waitFor()
    }],
    ["answer No and start: the desk opens", async (p) => {
      await p.getByRole("radio", { name: "No" }).check()
      await p.getByRole("button", { name: /^Find \d+ businesses/ }).click()
      await p.getByRole("heading", { level: 1, name: /Dentists within 5 mi/ }).waitFor({ timeout: 15_000 })
    }],
  ],
  settings: [
    ["open", async (p) => {
      await p.goto("/settings")
      await p.getByRole("heading", { level: 1, name: "Settings" }).waitFor()
    }],
    ["the jump list goes to Preferences", async (p) => {
      await p.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Preferences" }).click()
      await p.waitForFunction(() => document.activeElement?.textContent === "Preferences")
    }],
    ["a switch saves at once and says so", async (p) => {
      await p.getByRole("switch", { name: "Compact rows" }).click()
      await p.getByText("Saved", { exact: true }).first().waitFor()
      if ((await p.getByRole("switch", { name: "Compact rows" }).getAttribute("aria-checked")) !== "true") throw new Error("Compact rows did not turn on")
      await p.getByRole("switch", { name: "Compact rows" }).click()
    }],
    ["the theme switches to dark and back", async (p) => {
      await p.getByRole("radio", { name: "Dark" }).click()
      await p.waitForFunction(() => document.documentElement.classList.contains("dark"))
      await p.getByRole("radio", { name: "Light" }).click()
      await p.waitForFunction(() => !document.documentElement.classList.contains("dark"))
    }],
    ["the footer preview follows the form", async (p) => {
      await p.getByRole("textbox", { name: /Job title/ }).fill("Owner")
      await p.locator('[data-testid="footer-preview"]', { hasText: "Owner, Brightline Ads" }).waitFor()
      await p.getByText("Preview of your changes.", { exact: false }).waitFor()
    }],
    ["an empty name is caught on save", async (p) => {
      await p.getByRole("textbox", { name: "Your name" }).fill("")
      await p.getByRole("button", { name: "Save sender profile" }).click()
      await p.getByText("Enter your name as it should appear in emails.").waitFor()
    }],
    ["the profile saves", async (p) => {
      await p.getByRole("textbox", { name: "Your name" }).fill("Maya Chen")
      await p.getByRole("button", { name: "Save sender profile" }).click()
      await p.locator('[data-testid="footer-preview"]', { hasText: "Owner, Brightline Ads" }).waitFor()
      await p.getByText("Saved", { exact: true }).first().waitFor()
    }],
    ["delete all data asks for the word", async (p) => {
      await p.getByRole("textbox", { name: "Type delete to confirm" }).fill("nope")
      await p.getByRole("button", { name: "Delete all data" }).click()
      await p.getByText("Type delete to confirm.").waitFor()
    }],
    ["typing delete starts over at set-up", async (p) => {
      await p.getByRole("textbox", { name: "Type delete to confirm" }).fill("delete")
      await p.getByRole("button", { name: "Delete all data" }).click()
      await p.getByRole("heading", { level: 1, name: "Set up your sender profile" }).waitFor()
      await p.getByText("All data deleted").waitFor()
    }],
    ["set-up checks the required fields", async (p) => {
      await p.getByRole("button", { name: "Save and set up a campaign" }).click()
      await p.getByText("Enter your name as it should appear in emails.").waitFor()
      await p.getByText("Enter your company's name.").waitFor()
    }],
    ["set-up saves and continues to New campaign", async (p) => {
      await p.getByRole("textbox", { name: "Your name" }).fill("Maya Chen")
      await p.getByRole("textbox", { name: "Company" }).fill("Brightline Ads")
      await p.getByRole("textbox", { name: "Postal address" }).fill("123 Example St, Arlington, VA 22201")
      await p.locator('[data-testid="footer-preview"]', { hasText: "123 Example St" }).waitFor()
      await p.getByRole("button", { name: "Save and set up a campaign" }).click()
      await p.getByRole("heading", { level: 1, name: "New campaign" }).waitFor()
    }],
  ],
  sent: [
    ["open on Approved", async (p) => {
      await p.goto("/sent")
      await p.getByRole("tab", { name: /Approved/, selected: true }).waitFor()
      await visible(p, "[data-sent-id]")
      if ((await p.locator("[data-sent-id]").count()) !== 2) throw new Error("expected 2 approved emails")
    }],
    ["mark as sent fills the meter", async (p) => {
      await p.locator("[data-sent-id]").filter({ hasText: "Sample Duct Masters" }).getByRole("button", { name: "Mark as sent" }).click()
      await sentToday(p, "8 of 20")
      await gone(p, '[data-sent-id]:has-text("Sample Duct Masters")')
    }],
    ["undo puts it back", async (p) => {
      await p.getByRole("button", { name: "Undo" }).click()
      await sentToday(p, "7 of 20")
      await visible(p, '[data-sent-id]:has-text("Sample Duct Masters")')
    }],
    ["the Sent tab filters through the address", async (p) => {
      await p.getByRole("tab", { name: /^Sent/ }).click()
      await p.waitForURL(/status=sent/)
      await visible(p, '[data-sent-id]:has-text("Sample Bright Dental")')
    }],
    ["No thanks logs the reply and adds do not contact", async (p) => {
      await p.locator("[data-sent-id]").filter({ hasText: "Sample Bright Dental" }).getByRole("button", { name: "No thanks" }).click()
      await p.getByText("Sample Bright Dental: No thanks. Added to your do-not-contact list.").waitFor()
    }],
    ["the reply shows under Replied", async (p) => {
      await p.getByRole("tab", { name: /Replied/ }).click()
      await p.locator("[data-sent-id]").filter({ hasText: "Sample Bright Dental" }).filter({ hasText: "No thanks" }).waitFor()
    }],
    ["sort by business", async (p) => {
      await p.getByRole("tab", { name: /All/ }).click()
      await p.getByRole("button", { name: "Business" }).click()
      await p.locator('th[aria-sort="ascending"]', { hasText: "Business" }).waitFor()
    }],
    ["a business opens on its review desk", async (p) => {
      await p.getByRole("link", { name: "Sample Bright Dental" }).click()
      await p.locator('[data-slot="lead-header"] h2', { hasText: "Sample Bright Dental" }).waitFor()
    }],
  ],
  numbers: [
    ["open", async (p) => {
      await p.goto("/numbers")
      await p.getByRole("heading", { level: 2, name: "This week" }).waitFor()
      await visible(p, '[data-slot="stat-tile"]')
    }],
    ["the funnel switches to its table and back", async (p) => {
      const funnel = p.locator("section").filter({ has: p.getByRole("heading", { name: "Funnel" }) })
      await funnel.getByRole("button", { name: "Table" }).click()
      await funnel.getByRole("table", { name: "Funnel, all campaigns" }).waitFor()
      await funnel.getByRole("button", { name: "Chart" }).click()
      await funnel.getByRole("list", { name: "Funnel steps" }).waitFor()
    }],
    ["a weekly chart shows its table", async (p) => {
      const card = p.locator("[data-slot=chart-card]").filter({ has: p.getByRole("heading", { level: 3, name: "Found" }) })
      await card.getByRole("button", { name: "Table" }).click()
      const rows = await card.getByRole("table", { name: "Found by week" }).getByRole("row").count()
      if (rows !== 9) throw new Error(`expected 9 rows, got ${rows}`)
      await card.getByRole("button", { name: "Chart" }).click()
      await card.locator("svg.recharts-surface").waitFor()
    }],
    ["hovering a week shows its tooltip", async (p) => {
      const card = p.locator("[data-slot=chart-card]").filter({ has: p.getByRole("heading", { level: 3, name: "Sent" }) })
      const box = await card.locator("svg.recharts-surface").boundingBox()
      await p.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6)
      await card.getByText(/^Week of /).waitFor()
    }],
    ["Export CSV downloads the numbers", async (p) => {
      const download = p.waitForEvent("download")
      await p.getByRole("button", { name: "Export CSV" }).click()
      const file = await download
      if (file.suggestedFilename() !== "nearbynudge-numbers.csv") throw new Error(file.suggestedFilename())
    }],
    ["a campaign opens on its review desk", async (p) => {
      await p.getByRole("table", { name: "Numbers by campaign" }).getByRole("link").first().click()
      await p.getByRole("heading", { level: 1 }).filter({ hasText: /within/ }).waitFor()
    }],
  ],
  dnc: [
    ["open", async (p) => {
      await p.goto("/dnc")
      await p.getByRole("heading", { level: 1, name: "Do not contact" }).waitFor()
      await visible(p, '[data-testid="dnc-row"]')
    }],
    ["an empty add asks for one identifier", async (p) => {
      await p.getByRole("button", { name: "Add to list" }).click()
      await p.getByText("Add a business name, a website or an email address.").waitFor()
    }],
    ["add a business with a reason", async (p) => {
      const form = p.getByRole("form", { name: "Add to the Do not contact list" })
      await form.getByRole("textbox", { name: "Business name" }).fill("Harbor Family Dentistry")
      await form.getByRole("textbox", { name: /Reason/ }).fill("Already a client")
      await form.getByRole("button", { name: "Add to list" }).click()
      await form.getByText("Added Harbor Family Dentistry.").waitFor()
      await p.getByTestId("dnc-row").filter({ hasText: "Harbor Family Dentistry" }).filter({ hasText: "Reason: Already a client" }).waitFor()
    }],
    ["search narrows the list", async (p) => {
      await p.getByRole("searchbox", { name: "Search the list" }).fill("harbor")
      await p.getByText("1 match for “harbor”").waitFor()
    }],
    ["a search with no match clears", async (p) => {
      await p.getByRole("searchbox", { name: "Search the list" }).fill("zzzz")
      await p.getByText("Nothing matches “zzzz”").waitFor()
      await p.getByRole("button", { name: "Clear search" }).first().click()
      await p.getByText("4 entries on your list").waitFor()
    }],
    ["remove keeps Undo on the row", async (p) => {
      await p.getByRole("button", { name: "Remove Sample Roofing Co." }).click()
      await p.getByTestId("dnc-removed-row").filter({ hasText: "Removed Sample Roofing Co." }).waitFor()
    }],
    ["Undo puts it back", async (p) => {
      await p.getByRole("button", { name: "Undo removing Sample Roofing Co." }).click()
      await p.getByTestId("dnc-row").filter({ hasText: "Sample Roofing Co." }).waitFor()
      await gone(p, '[data-testid="dnc-removed-row"]')
    }],
    ["Export CSV downloads the list", async (p) => {
      const download = p.waitForEvent("download")
      await p.getByRole("button", { name: "Export CSV" }).click()
      const file = await download
      if (file.suggestedFilename() !== "do-not-contact.csv") throw new Error(file.suggestedFilename())
    }],
  ],
  admin: [
    ["open", async (p) => {
      await p.goto("/admin")
      await p.getByRole("heading", { level: 1, name: "Admin console" }).waitFor()
      await visible(p, '[data-slot="stat-tile"]')
    }],
    ["the jump list goes to the audit sample", async (p) => {
      await p.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Audit sample" }).click()
      await p.waitForFunction(() => document.activeElement?.textContent === "Audit sample")
    }],
    ["a fact can be marked supported, then not supported", async (p) => {
      const fact = p.locator("#audit details").first().getByRole("listitem").first()
      await fact.getByRole("button", { name: "Supported", exact: true }).click()
      await fact.locator('button[aria-pressed="true"]', { hasText: "Supported" }).waitFor()
      await fact.getByRole("button", { name: "Not supported" }).click()
      await fact.locator('button[aria-pressed="true"]', { hasText: "Not supported" }).waitFor()
    }],
    ["the daily cost shows its table", async (p) => {
      const daily = p.locator("#spend [data-slot=chart-card]")
      await daily.getByRole("button", { name: "Table" }).click()
      const rows = await daily.getByRole("table", { name: "Daily AI cost, last 30 days" }).getByRole("row").count()
      if (rows !== 31) throw new Error(`expected 31 rows, got ${rows}`)
      await daily.getByRole("button", { name: "Chart" }).click()
    }],
    ["a bad balance is caught", async (p) => {
      const balance = p.locator("#balance")
      await balance.getByRole("textbox", { name: "Current prepaid balance" }).fill("lots")
      await balance.getByRole("button", { name: "Save balance" }).click()
      await balance.getByText("Enter dollars and cents only, like 50 or 125.40.").waitFor()
    }],
    ["a balance saves and the forecast updates", async (p) => {
      const balance = p.locator("#balance")
      await balance.getByRole("textbox", { name: "Current prepaid balance" }).fill("125.40")
      await balance.getByRole("button", { name: "Save balance" }).click()
      await balance.getByText("$125.40").first().waitFor()
    }],
    ["an opt-out needs its domain", async (p) => {
      const optOuts = p.locator("#optouts")
      await optOuts.getByRole("button", { name: "Add opt-out" }).click()
      await optOuts.getByText("Enter the site's domain, like example.com.").waitFor()
    }],
    ["add an opt-out", async (p) => {
      const optOuts = p.locator("#optouts")
      await optOuts.getByRole("textbox", { name: "Website domain" }).fill("flow-test.example")
      await optOuts.getByRole("button", { name: "Add opt-out" }).click()
      await optOuts.getByRole("row").filter({ hasText: "flow-test.example" }).waitFor()
    }],
    ["removing an opt-out asks first", async (p) => {
      const optOuts = p.locator("#optouts")
      await optOuts.getByRole("button", { name: "Remove the opt-out for flow-test.example" }).click()
      await optOuts.getByText("NearbyNudgeBot may read flow-test.example again.").waitFor()
      await optOuts.getByRole("button", { name: "Remove opt-out" }).click()
      await gone(p, '#optouts tr:has-text("flow-test.example")')
    }],
  ],
  public: [
    ["open the bot page", async (p) => {
      await p.goto("/bot")
      await p.getByRole("heading", { level: 1, name: "NearbyNudgeBot" }).waitFor()
    }],
    ["the opt-out form checks its fields", async (p) => {
      const form = p.getByRole("form", { name: "Opt-out request" })
      await form.getByRole("button", { name: "Send opt-out request" }).click()
      await form.getByText("Enter your website's address, such as example.com.").waitFor()
    }],
    ["an opt-out request is received", async (p) => {
      const form = p.getByRole("form", { name: "Opt-out request" })
      await form.getByRole("textbox", { name: "Your website" }).fill("flow-site.example")
      await form.getByRole("textbox", { name: "Your email" }).fill("owner@flow-site.example")
      await form.getByRole("button", { name: "Send opt-out request" }).click()
      await p.getByTestId("optout-confirmation").getByRole("heading", { name: /Request received for flow-site.example/ }).waitFor()
    }],
    ["send another request brings the form back", async (p) => {
      await p.getByRole("button", { name: "Send another request" }).click()
      await p.getByRole("form", { name: "Opt-out request" }).waitFor()
    }],
    ["the footer leads to Data sources, Privacy and Terms", async (p) => {
      const footer = p.getByRole("navigation", { name: "About NearbyNudge" })
      await footer.getByRole("link", { name: "Data sources" }).click()
      await p.getByRole("heading", { level: 1, name: "Data sources" }).waitFor()
      await footer.getByRole("link", { name: "Privacy" }).click()
      await p.getByRole("heading", { level: 1, name: /Privacy/ }).waitFor()
      await footer.getByRole("link", { name: "Terms" }).click()
      await p.getByRole("heading", { level: 1, name: /Terms/ }).waitFor()
    }],
    ["a dead link says so and leads home", async (p) => {
      await p.goto("/no-such-listing")
      await p.getByRole("heading", { level: 1, name: "We couldn't find that page" }).waitFor()
      await p.getByText("/no-such-listing").waitFor()
      await p.getByRole("link", { name: "Go to campaigns" }).click()
      await p.getByRole("heading", { level: 1, name: "Campaigns" }).waitFor()
    }],
  ],
  desk: [
    ["open", async (p) => {
      await p.goto(CAMPAIGN)
      await visible(p, '[data-slot="email-text"]')
    }],
    ["next lead with J", async (p) => {
      await p.keyboard.press("j")
      await p.getByRole("heading", { level: 2, name: "Sample Family Dental" }).waitFor()
    }],
    ["back with K", async (p) => {
      await p.keyboard.press("k")
      await p.getByRole("heading", { level: 2, name: "Sample Dental Studio" }).waitFor()
    }],
    ["approve with A", async (p) => {
      await p.keyboard.press("a")
      await visible(p, '[data-slot="sending-preview"]')
    }],
    ["mark as sent with M (the desk moves to the next lead)", async (p) => {
      await p.keyboard.press("m")
      await sentToday(p, "8 of 20")
    }],
    ["undo with Z", async (p) => {
      await p.keyboard.press("z")
      await sentToday(p, "7 of 20")
    }],
    ["approve, then undo the approval", async (p) => {
      await p.goto(CAMPAIGN)
      await visible(p, '[data-slot="email-text"]')
      await p.keyboard.press("a")
      // The toast and the sending preview both offer it, under the same name; use the desk's.
      await p.locator('[data-slot="sending-preview"]').getByRole("button", { name: "Undo approval" }).click()
      await rowStatus(p, "Sample Dental Studio").filter({ hasText: "Ready" }).waitFor()
    }],
    ["skip reasons with S", async (p) => {
      await p.keyboard.press("s")
      await visible(p, '[data-slot="skip-reasons"]')
    }],
    ["close skip with Esc", async (p) => {
      await p.keyboard.press("Escape")
      await gone(p, '[data-slot="skip-reasons"]')
    }],
    ["do not contact asks first (Shift+D)", async (p) => {
      await p.keyboard.press("Shift+D")
      await p.getByRole("button", { name: "Never contact Sample Dental Studio" }).waitFor()
    }],
    ["cancel do not contact", async (p) => {
      await p.getByRole("button", { name: "Cancel" }).click()
      await visible(p, '[data-slot="action-bar"] >> text=Approve')
    }],
    ["rewrite shorter with 1", async (p) => {
      await p.keyboard.press("1")
      await p.getByRole("button", { name: "Show changes" }).waitFor({ timeout: 15_000 })
    }],
    ["show the changes", async (p) => {
      await p.getByRole("button", { name: "Show changes" }).click()
      await visible(p, '[data-slot="changes-view"]')
    }],
    ["edit with E", async (p) => {
      await p.getByRole("button", { name: "Hide changes" }).click()
      await p.keyboard.press("e")
      await visible(p, '[data-slot="email-editor"]')
    }],
    ["cancel the edit with Esc", async (p) => {
      await p.keyboard.press("Escape")
      await visible(p, '[data-slot="email-text"]')
    }],
    ["command menu goes to Sent", async (p) => {
      await p.keyboard.press("Control+k")
      await p.getByRole("dialog", { name: "Command menu" }).waitFor()
      // The full name: on the desk, a bare "Sent" fuzzy-matches "Never contact Sample Dental Studio" first.
      await p.keyboard.type("Go to Sent")
      await p.keyboard.press("Enter")
      await p.getByRole("heading", { level: 1, name: "Sent" }).waitFor()
    }],
  ],
}

async function runFlow(browser, name, outDir) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference",
  })
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("nn-mock-speed", "0")
    } catch {
      // the mock falls back to its defaults
    }
  })
  const page = await context.newPage()
  const problems = []
  page.on("pageerror", (error) => problems.push(error.message))
  let step = 0
  try {
    for (const [label, action] of FLOWS[name]) {
      step += 1
      await action(page)
      // Let the step's motion finish; "disabled" would cancel animations the page waits on.
      await page.waitForTimeout(450)
      const file = path.join(outDir, `${name}-${String(step).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}.png`)
      await page.screenshot({ path: file, caret: "hide" })
      console.log(`  ok    ${name}: ${label}`)
    }
    if (problems.length) throw new Error(`page errors: ${problems.join(" | ")}`)
  } catch (error) {
    // Keep a picture of the moment it failed, next to the steps that passed, and say what was open.
    await page.screenshot({ path: path.join(outDir, `${name}-FAILED-step-${step}.png`) }).catch(() => {})
    const open = await page
      .evaluate(() => ({
        focus: `${document.activeElement?.tagName} ${(document.activeElement?.textContent ?? "").slice(0, 40)}`,
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => {
          const id = d.getAttribute("aria-labelledby")
          return (id && document.getElementById(id)?.textContent) || d.getAttribute("aria-label") || "(no name)"
        }),
        panels: [...document.querySelectorAll('[data-slot="dnc-confirm"],[data-slot="skip-reasons"]')].map((e) => e.getAttribute("data-slot")),
      }))
      .catch(() => null)
    if (open) console.log(`        open at failure: ${JSON.stringify(open)}`)
    throw new Error(`${name}, step ${step}: ${String(error?.message ?? error).split("\n")[0]}`)
  } finally {
    await context.close()
  }
}

// ---------------------------------------------------------------------------
// The sample-data dashboard
// ---------------------------------------------------------------------------

async function isUp() {
  try {
    const response = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

async function startDashboard() {
  if (!existsSync(VITE)) throw new Error("Vite isn't installed. Run `npm install` in frontend/ first.")
  if (await isUp()) {
    throw new Error(`Something already answers on port ${PORT}. Stop it, or set DESIGN_REVIEW_PORT to a free port.`)
  }
  const child = spawn(process.execPath, [VITE, "--mode", "mock", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: FRONTEND,
    stdio: ["ignore", "ignore", "pipe"],
  })
  let stderr = ""
  child.stderr.on("data", (chunk) => (stderr += chunk))
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The sample-data dashboard didn't start:\n${stderr}`)
    if (await isUp()) return child
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  child.kill()
  throw new Error("The sample-data dashboard didn't start within 90 seconds.")
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

/** Waits until fonts are in and nothing is loading, then lets one frame settle. */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(350)
}

/**
 * The app scrolls inside <main>, not the document, so a plain full-page shot would
 * stop at the window. Grow the window until <main> has nothing left to scroll.
 */
async function growToContent(page, size) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const needed = await page.evaluate(() => {
      const main = document.getElementById("main-content")
      let height = document.documentElement.scrollHeight
      if (main && main.scrollHeight > main.clientHeight + 1) {
        height = Math.max(height, Math.ceil(main.getBoundingClientRect().top + main.scrollHeight))
      }
      return height
    })
    const target = Math.min(Math.max(needed, size.height), 12_000)
    if (Math.abs(target - (page.viewportSize()?.height ?? 0)) < 2) return
    await page.setViewportSize({ width: size.width, height: target })
    await page.waitForTimeout(250)
  }
}

async function shoot(browser, screen, size, theme, outDir) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.mobile ? 2 : 1,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    colorScheme: theme,
    reducedMotion: "reduce",
  })
  // Freeze the sample research so every run shows the same moment.
  await context.addInitScript((values) => {
    try {
      for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value)
    } catch {
      // storage blocked: the mock falls back to its defaults
    }
  }, { "nn-mock-speed": "0", ...screen.settings })
  const page = await context.newPage()
  const problems = []
  page.on("pageerror", (error) => problems.push(error.message))
  page.on("console", (message) => message.type() === "error" && problems.push(message.text()))
  const file = path.join(outDir, `${screen.name}-${size.name}${theme === "dark" ? "-dark" : ""}.png`)
  try {
    await page.goto(screen.path, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await screen.ready(page, size)
    await settle(page)
    if (screen.prepare) {
      await screen.prepare(page, size)
      await settle(page)
    }
    if (!screen.window) await growToContent(page, size)
    // Park the pointer in the empty top-left corner so a clicked button isn't caught mid-hover.
    await page.mouse.move(0, 0)
    await page.screenshot({ path: file, fullPage: !screen.window, animations: "disabled", caret: "hide" })
    return { file, problems }
  } finally {
    await context.close()
  }
}

async function main() {
  const [phase, ...names] = process.argv.slice(2)
  if (phase === "list") {
    for (const screen of SCREENS) console.log(screen.name)
    console.log(`flows: ${Object.keys(FLOWS).join(", ")}`)
    return
  }
  if (phase === "flows") {
    const chosen = names.length ? names : Object.keys(FLOWS)
    const unknownFlows = chosen.filter((name) => !FLOWS[name])
    if (unknownFlows.length) throw new Error(`Unknown flow: ${unknownFlows.join(", ")}`)
    const outDir = path.join(HERE, "after", "flows")
    await mkdir(outDir, { recursive: true })
    console.log(`Starting the sample-data dashboard on ${BASE} ...`)
    const server = await startDashboard()
    const browser = await chromium.launch()
    const failures = []
    try {
      for (const name of chosen) {
        try {
          await runFlow(browser, name, outDir)
        } catch (error) {
          failures.push(name)
          console.log(`  FAIL  ${String(error?.message ?? error)}`)
        }
      }
    } finally {
      await browser.close()
      if (server.exitCode === null) server.kill()
    }
    console.log(failures.length ? `\nFlows failed: ${failures.join(", ")}` : `\nAll flows passed (${chosen.join(", ")}).`)
    if (failures.length) process.exitCode = 1
    return
  }
  if (phase !== "before" && phase !== "after") {
    console.log("Usage: node design-review/shoot.mjs <before|after> [screen ...]   (or: list, flows [flow ...])")
    process.exitCode = 2
    return
  }
  const unknown = names.filter((name) => !SCREENS.some((s) => s.name === name))
  if (unknown.length) throw new Error(`Unknown screen: ${unknown.join(", ")}. Run with "list" to see the names.`)
  const selected = names.length ? SCREENS.filter((s) => names.includes(s.name)) : SCREENS
  const outDir = path.join(HERE, phase)
  await mkdir(outDir, { recursive: true })

  console.log(`Starting the sample-data dashboard on ${BASE} ...`)
  const server = await startDashboard()
  const stop = () => server.exitCode === null && server.kill()
  process.on("exit", stop)
  process.on("SIGINT", () => {
    stop()
    process.exit(130)
  })

  const browser = await chromium.launch()
  const failures = []
  let saved = 0
  try {
    for (const screen of selected) {
      for (const theme of screen.dark ? ["light", "dark"] : ["light"]) {
        for (const size of SIZES) {
          if (screen.only && screen.only !== (size.mobile ? "mobile" : "desktop")) continue
          const label = `${screen.name} ${size.name}${theme === "dark" ? " dark" : ""}`
          try {
            const { file, problems } = await shoot(browser, screen, size, theme, outDir)
            saved += 1
            const note = problems.length ? `  (console errors: ${problems.slice(0, 2).join(" | ")})` : ""
            console.log(`  ok    ${label.padEnd(30)} ${path.relative(ROOT, file)}${note}`)
          } catch (error) {
            failures.push(label)
            console.log(`  FAIL  ${label.padEnd(30)} ${String(error?.message ?? error).split("\n")[0]}`)
          }
        }
      }
    }
  } finally {
    await browser.close()
    stop()
  }
  console.log(`\n${saved} screenshots in ${path.relative(ROOT, outDir)}${failures.length ? `, ${failures.length} failed: ${failures.join(", ")}` : ""}`)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error?.message ?? error)
  process.exitCode = 1
})
