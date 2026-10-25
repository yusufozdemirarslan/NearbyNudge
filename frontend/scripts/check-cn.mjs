// Fails when the class merger (src/lib/utils.ts) and the type scale (src/index.css)
// disagree: any `text-<size>` the merger doesn't know is treated as a colour and
// silently dropped next to `text-edge` and friends. Run by `npm run build`.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(join(root, "package.json"))
const { createCn } = await import(pathToFileURL(require.resolve("cn/config")).href)

// The sizes the stylesheet defines: `--text-<name>: ...` inside @theme.
const css = readFileSync(join(root, "src", "index.css"), "utf8")
const defined = [...css.matchAll(/^\s*--text-([a-z]+(?:-[a-z]+)*):/gm)].map((m) => m[1])
// The sizes the merger knows, read from its config.
const utils = readFileSync(join(root, "src", "lib", "utils.ts"), "utf8")
const known = [...utils.matchAll(/^\s+"([a-z-]+)",?$/gm)].map((m) => m[1])

const cn = createCn({ extend: { classGroups: { "font-size": [{ text: known }] } } })
const problems = []
for (const size of defined) {
  if (!known.includes(size)) problems.push(`text-${size} is in index.css but not in the cn() config`)
  const merged = cn(`text-${size}`, "text-edge")
  if (merged !== `text-${size} text-edge`) problems.push(`cn("text-${size}", "text-edge") gave "${merged}"`)
}
if (defined.length === 0) problems.push("found no --text-* sizes in index.css")

if (problems.length) {
  console.error("check:cn failed:\n  " + problems.join("\n  "))
  process.exit(1)
}
console.log(`check:cn: ${defined.length} type sizes merge as sizes (${defined.join(", ")}).`)
