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

/** Opens a page from the main navigation (the navigation is a slide-out sheet on phones). */
async function openFromNav(page, size, name) {
  if (size.mobile) await page.getByRole("button", { name: "Show or hide navigation" }).click()
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
      await p.keyboard.press("Control+K")
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
    return
  }
  if (phase !== "before" && phase !== "after") {
    console.log("Usage: node design-review/shoot.mjs <before|after> [screen ...]   (or: list)")
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
