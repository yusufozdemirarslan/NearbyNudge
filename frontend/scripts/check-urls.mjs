#!/usr/bin/env node
// Fails the build if the compiled app contains any http:// or https://
// address that isn't on the short allowlist in scripts/url-allowlist.json.
//
// The browser may only talk to our own server (CSP default-src 'self'), so
// any outside address in dist/ is either a documentation string (XML
// namespaces, React's error-decoder link) or a mistake (a font service, a CDN,
// a tracker). Every allowlist entry says why it is harmless.
//
// It also fails if development-only mock data reached the bundle.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
// Optional folder argument, for builds made outside dist/.
const dist = join(root, process.argv[2] ?? "dist")
const allowlist = JSON.parse(readFileSync(join(root, "scripts", "url-allowlist.json"), "utf8"))
const TEXT = new Set([".js", ".mjs", ".css", ".html", ".svg", ".json", ".txt", ".xml", ".webmanifest", ".map"])
// Strings that only exist in the mock adapter (src/lib/api/mock).
const MOCK_MARKERS = ["samplestudio.example", "Sample Dental Studio", "nn-mock-speed", "2.0.0-mock"]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

let files
try {
  files = walk(dist)
} catch {
  console.error(`check:urls: ${relative(root, dist)}/ not found. Run vite build first.`)
  process.exit(1)
}

const urlPattern = /https?:\/\/[^\s"'`<>()\\{}|^]*/gu
const problems = []
const seen = new Map()

for (const file of files) {
  if (!TEXT.has(extname(file))) continue
  const text = readFileSync(file, "utf8")
  for (const match of text.matchAll(urlPattern)) {
    const url = match[0]
    const entry = allowlist.find((item) => (item.match === "prefix" ? url.startsWith(item.url) : url === item.url))
    const rel = relative(root, file)
    if (entry) {
      seen.set(entry.url, (seen.get(entry.url) ?? 0) + 1)
      continue
    }
    const at = Math.max(0, match.index - 60)
    problems.push({ file: rel, url, context: text.slice(at, match.index + url.length + 40).replace(/\s+/gu, " ") })
  }
  for (const marker of MOCK_MARKERS) {
    if (text.includes(marker)) problems.push({ file: relative(root, file), url: `(mock data: ${marker})`, context: "" })
  }
}

if (problems.length > 0) {
  console.error(`check:urls found ${problems.length} address(es) that are not allowed:\n`)
  for (const p of problems) {
    console.error(`  ${p.file}: ${p.url}`)
    if (p.context) console.error(`      …${p.context}…`)
  }
  console.error("\nRemove the outside address, or add it to scripts/url-allowlist.json with a reason if it is never fetched.")
  process.exit(1)
}

const summary = [...seen.entries()].map(([url, n]) => `${url} (${n})`).join(", ")
console.log(`check:urls: ${files.length} files scanned, no outside addresses. Allowlisted strings: ${summary || "none"}.`)
