import { expect, LIVE_CAMPAIGN, test, usingRealBackend } from "./fixtures"

/*
 * "Export CSV" for selected leads builds the spreadsheet in the browser. It must open in a
 * spreadsheet app without running a formula that a name, a phone or a subject starts with,
 * and keep accented names readable (UTF-8 with a byte-order mark), like the server's exports.
 */
test.skip(usingRealBackend, "Uses the mock adapter's sample campaign and the dev server's source modules")

test("cells that start like a formula are kept as text", async ({ page }) => {
  await page.goto("/")
  const csv = await page.evaluate(async () => {
    const path = "/src/lib/download.ts"
    const { toCsv } = (await import(path)) as { toCsv: (rows: (string | number | null)[][]) => string }
    return toCsv([['=HYPERLINK("x")', "+1 703-555-0100", "-2", "@SUM(A1)", "Plain, with a comma", 5, -3, null]])
  })
  expect(csv).toBe(`"'=HYPERLINK(""x"")",'+1 703-555-0100,'-2,'@SUM(A1),"Plain, with a comma",5,-3,`)
})

test("the selected-leads spreadsheet is UTF-8 that spreadsheet apps detect", async ({ page }) => {
  await page.goto(LIVE_CAMPAIGN)
  await expect(page.getByRole("heading", { level: 1, name: /Dentists within 5 mi/ })).toBeVisible()
  await expect(page.locator('[data-slot="email-text"]')).toBeVisible()
  await page.keyboard.press("x")
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export CSV" }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array))
  const text = Buffer.concat(chunks).toString("utf8")
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text).toContain("Business,Status,Fit")
})
