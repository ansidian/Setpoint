import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { checkSizeBaseline, isSizeCheckedSource } from './lib/component-sizes.mjs'

const root = process.cwd()
const componentSizeBaselinePath = 'docs/quality/component-size-baseline.json'

const failures = []
const warnings = []

async function exists(relativePath) {
  try {
    await fs.stat(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8')
}

async function collectFiles(dir, predicate) {
  const absoluteDir = path.join(root, dir)
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    // Emit POSIX-separated paths so they match the forward-slash keys in the
    // size + import-boundary baselines on Windows (path.join yields `\` there).
    const relativePath = path.join(dir, entry.name).split(path.sep).join('/')
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue
      files.push(...await collectFiles(relativePath, predicate))
      continue
    }

    if (predicate(relativePath)) {
      files.push(relativePath)
    }
  }

  return files
}

async function checkIgnoredKnowledge() {
  const gitignore = await readText('.gitignore')
  const lines = gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())

  if (lines.includes('AGENTS.md')) {
    failures.push('AGENTS.md should be tracked as the agent entry point')
  }

  if (!lines.includes('docs/')) {
    failures.push('docs/ should remain gitignored for this personal single-user repo')
  }
}

async function checkAgentsMap() {
  const agents = await readText('AGENTS.md')
  const lines = agents.trimEnd().split(/\r?\n/)
  if (lines.length > 120) {
    failures.push(`AGENTS.md is ${lines.length} lines; keep it near 100 lines and move details into docs/`)
  }

  for (const pointer of ['ARCHITECTURE.md', 'PRODUCT.md', 'DESIGN.md', 'gitignored for this personal single-user repo', 'red state', 'TDD Cycle', 'npm run check:harness']) {
    if (!agents.includes(pointer)) {
      failures.push(`AGENTS.md should point to ${pointer}`)
    }
  }
}

async function checkHistoricalDocsCleanup() {
  if (await exists('docs/superpowers')) {
    failures.push('docs/superpowers still exists; historical plans/specs should live under docs/exec-plans or docs/design-docs/history')
  }

  const generated = await readText('docs/generated/full-system-deep-dive-2026-04-12.md').catch(() => '')
  if (generated && !generated.includes('Generated')) {
    warnings.push('Generated deep dive does not identify itself as generated context')
  }
}

async function checkAreaMaps() {
  const { checkMaps, uncoveredThresholdViolations } = await import("./lib/map-coverage.mjs")
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
  const mapDirs = files
    .filter((f) => f.endsWith("/CLAUDE.md") && (f.startsWith("src/") || f.startsWith("server/")))
    .map((f) => f.slice(0, -"/CLAUDE.md".length))
  const maps = await Promise.all(
    mapDirs.map(async (dir) => ({ dir, text: await readText(`${dir}/CLAUDE.md`) })),
  )
  const result = checkMaps({ files, maps })
  failures.push(...result.failures)
  warnings.push(...result.warnings)
  failures.push(...uncoveredThresholdViolations({ files, mapDirs }))

  const flows = await readText("FLOWS.md").catch(() => "")
  if (flows) {
    const { missingDocPaths } = await import("./lib/map-coverage.mjs")
    for (const p of missingDocPaths(flows, files)) {
      failures.push(`FLOWS.md names missing file ${p}`)
    }
  }
}

async function checkImportBoundariesAcrossDomains() {
  const { collectCrossDomainEdges, checkImportBoundaries } = await import("./lib/import-boundaries.mjs")
  const config = JSON.parse(await readText("scripts/lib/import-boundaries-baseline.json"))
  const jsFiles = await collectFiles("server", (relativePath) => relativePath.endsWith(".js"))
  const files = await Promise.all(
    jsFiles.map(async (relativePath) => ({ path: relativePath, source: await readText(relativePath) })),
  )
  const edges = collectCrossDomainEdges({ files, domains: Object.keys(config.entries) })
  const result = checkImportBoundaries({ edges, entries: config.entries, baseline: config.edges })
  failures.push(...result.failures)
  warnings.push(...result.warnings)
}

async function readComponentSizeBaseline() {
  let raw
  try {
    raw = await readText(componentSizeBaselinePath)
  } catch {
    failures.push(`${componentSizeBaselinePath} is missing; regenerate it with { "threshold": 600, "files": {} } plus any grandfathered files`)
    return null
  }

  let baseline
  try {
    baseline = JSON.parse(raw)
  } catch {
    failures.push(`${componentSizeBaselinePath} is not valid JSON`)
    return null
  }

  if (typeof baseline.threshold !== 'number' || typeof baseline.files !== 'object' || baseline.files === null) {
    failures.push(`${componentSizeBaselinePath} must have a numeric "threshold" and a "files" object`)
    return null
  }

  return baseline
}

async function checkSourceFileSizes() {
  const baseline = await readComponentSizeBaseline()
  if (!baseline) return

  // Govern every non-test source file under src/ AND server/ — not just .jsx/.tsx under
  // /components/ or /pages/. Hooks (src/hooks/**) and loose .js controllers/models
  // were the first blind spot; the entire server/ tree (11 modules at 686-918 lines)
  // was the second, growing with no size enforcement at all.
  const sourceFiles = [
    ...await collectFiles('src', isSizeCheckedSource),
    ...await collectFiles('server', isSizeCheckedSource),
  ]
  const files = []
  for (const file of sourceFiles) {
    const text = await readText(file)
    const lineCount = text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0)
    files.push({ path: file, lineCount })
  }

  const result = checkSizeBaseline({ files, baseline })
  failures.push(...result.failures)
  warnings.push(...result.warnings)
}

await checkIgnoredKnowledge()
await checkAgentsMap()
await checkHistoricalDocsCleanup()
await checkAreaMaps()
await checkImportBoundariesAcrossDomains()
await checkSourceFileSizes()

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`)
}

if (failures.length > 0) {
  console.error('Agent harness check failed:')
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exit(1)
}

console.log('Agent harness check passed.')
