import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import process from "node:process"
import { checkMaps, scopeOf, isRequiredEntry, uncoveredThresholdViolations } from "./lib/map-coverage.mjs"

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
const mapDirs = files
  .filter((f) => f.endsWith("/CLAUDE.md") && (f.startsWith("src/") || f.startsWith("server/")))
  .map((f) => f.slice(0, -"/CLAUDE.md".length))

const target = process.argv[2]
if (target === "--list-scope" && process.argv[3]) {
  // print what a map at this dir would be required to cover (works before the map exists)
  const dir = process.argv[3].replace(/\/$/, "")
  const dirs = mapDirs.includes(dir) ? mapDirs : [...mapDirs, dir]
  for (const f of scopeOf(dir, dirs, files).filter(isRequiredEntry)) console.log(f)
  process.exit(0)
}

// Always check ALL maps so nested-map scope exclusion applies; in single-target
// mode, filter the report down to the target map afterwards.
const maps = await Promise.all(
  mapDirs.map(async (dir) => ({
    dir,
    text: await fs.readFile(`${dir}/CLAUDE.md`, "utf8"),
  })),
)
let { failures, warnings } = checkMaps({ files, maps })
if (target) {
  const prefix = `${target.replace(/\/$/, "")}/CLAUDE.md`
  failures = failures.filter((f) => f.startsWith(prefix))
  warnings = warnings.filter((w) => w.startsWith(prefix))
} else {
  failures.push(...uncoveredThresholdViolations({ files, mapDirs }))
}
warnings.forEach((w) => console.warn(`Warning: ${w}`))
failures.forEach((f) => console.error(`Failure: ${f}`))
process.exit(failures.length > 0 ? 1 : 0)
