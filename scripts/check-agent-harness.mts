import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  checkSizeBaseline,
  isSizeCheckedSource,
  isSizeCheckedTest,
} from './lib/component-sizes.mts'
import { findForbiddenSourcePatterns } from './lib/design-policy.mts'
import { findTestSourcePolicyViolations } from './lib/test-source-policy.mts'
import {
  checkTestArchitectureApprovalsEmpty,
  checkTestArchitectureBaseline,
  checkTestArchitectureBaselineEmpty,
  checkTestArchitectureBaselineGrowth,
  checkTestArchitectureMockMetadataObservations,
  collectPersistenceHeuristicSignals,
  collectTestArchitectureMetrics,
  hasPersistenceContractSignals,
  normalizeTestArchitecturePath,
} from './lib/test-architecture-policy.mts'
import {
  checkTestArchitectureOwnership,
  checkTestArchitectureSemanticInventory,
} from './lib/test-architecture-ownership.mts'

const root = process.cwd()
const componentSizeBaselinePath = 'scripts/lib/component-size-baseline.json'
const testSizeBaselinePath = 'scripts/lib/test-size-baseline.json'
const testArchitectureBaselinePath = 'scripts/lib/test-architecture-baseline.json'
const testArchitectureApprovalsPath = 'scripts/lib/test-architecture-baseline-approvals.json'
const testArchitectureSemanticInventoryPath = 'scripts/lib/test-architecture-semantic-inventory.json'

const failures: string[] = []
const warnings: string[] = []

async function exists(relativePath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.join(root, relativePath), 'utf8')
}

async function collectFiles(dir: string, predicate: (relativePath: string) => boolean): Promise<string[]> {
  const absoluteDir = path.join(root, dir)
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true })
  const files: string[] = []

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

  for (const pointer of ['ARCHITECTURE.md', 'PRODUCT.md', 'DESIGN.md', 'gitignored for this personal single-user repo', 'npm run check:harness', 'A product requirement or regression triggers a test']) {
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
  const { checkMaps, uncoveredThresholdViolations } = await import("./lib/map-coverage.mts")
  const listedFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
  // `git ls-files --cached` includes tracked paths deleted in the working tree.
  // Exclude them so removing a mapped source file does not require retaining a
  // stale CLAUDE.md entry until the deletion happens to be staged.
  const files: string[] = []
  for (const file of listedFiles) {
    if (await exists(file)) files.push(file)
  }
  const mapDirs = files
    .filter((f) => f.endsWith("/CLAUDE.md") && (f.startsWith("src/") || f.startsWith("server/") || f.startsWith("shared/")))
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
    const { missingDocPaths } = await import("./lib/map-coverage.mts")
    for (const p of missingDocPaths(flows, files)) {
      failures.push(`FLOWS.md names missing file ${p}`)
    }
  }
}

async function checkImportBoundariesAcrossDomains() {
  const { collectCrossDomainEdges, checkImportBoundaries } = await import("./lib/import-boundaries.mts")
  const config = JSON.parse(await readText("scripts/lib/import-boundaries-baseline.json"))
  const sourceFiles = await collectFiles("server", (relativePath) => /\.(?:ts|tsx)$/.test(relativePath))
  const files = await Promise.all(
    sourceFiles.map(async (relativePath) => ({ path: relativePath, source: await readText(relativePath) })),
  )
  const edges = collectCrossDomainEdges({ files, domains: Object.keys(config.entries) })
  const result = checkImportBoundaries({ edges, entries: config.entries, baseline: config.edges })
  failures.push(...result.failures)
  warnings.push(...result.warnings)
}

async function readSizeBaseline(baselinePath: string) {
  let raw
  try {
    raw = await readText(baselinePath)
  } catch {
    failures.push(`${baselinePath} is missing; regenerate it with { "threshold": 600, "files": {} } plus any grandfathered files`)
    return null
  }

  let baseline
  try {
    baseline = JSON.parse(raw)
  } catch {
    failures.push(`${baselinePath} is not valid JSON`)
    return null
  }

  if (typeof baseline.threshold !== 'number' || typeof baseline.files !== 'object' || baseline.files === null) {
    failures.push(`${baselinePath} must have a numeric "threshold" and a "files" object`)
    return null
  }

  return baseline
}

async function checkSourceFileSizes() {
  const baseline = await readSizeBaseline(componentSizeBaselinePath)
  if (!baseline) return

  // Govern every non-test source file under src/ AND server/ — not just .tsx under
  // /components/ or /pages/. Hooks (src/hooks/**) and loose controllers/models
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

function checkModuleReachability() {
  try {
    execFileSync(process.execPath, ["scripts/check-module-reachability.mts"], {
      cwd: root,
      encoding: "utf8",
    })
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string }
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    failures.push(`module reachability check failed${detail ? `:\n${detail}` : ""}`)
  }
}

function checkExportReachability() {
  try {
    execFileSync(process.execPath, ["scripts/audit-test-only-exports.mts"], {
      cwd: root,
      encoding: "utf8",
    })
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string }
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    failures.push(`export reachability check failed${detail ? `:\n${detail}` : ""}`)
  }
}

async function checkTestFileSizes() {
  const baseline = await readSizeBaseline(testSizeBaselinePath)
  if (!baseline) return

  const testFiles = [
    ...await collectFiles('src', isSizeCheckedTest),
    ...await collectFiles('server', isSizeCheckedTest),
    ...await collectFiles('scripts', isSizeCheckedTest),
  ]
  const files = []
  for (const file of testFiles) {
    const text = await readText(file)
    const lineCount = text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0)
    files.push({ path: file, lineCount })
  }

  const result = checkSizeBaseline({
    files,
    baseline,
    baselineName: 'test-size',
    debtName: 'test-file',
  })
  failures.push(...result.failures)
  warnings.push(...result.warnings)
}

async function checkTestSourcePolicies() {
  const testFiles = [
    ...await collectFiles('src', isSizeCheckedTest),
    ...await collectFiles('server', isSizeCheckedTest),
    ...await collectFiles('scripts', isSizeCheckedTest),
  ]

  for (const file of testFiles) {
    const source = await readText(file)
    for (const violation of findTestSourcePolicyViolations(source, file)) {
      failures.push(
        `${file}:${violation.line}:${violation.column} ${violation.message}`,
      )
    }
  }
}

async function checkTestArchitecture() {
  const testFiles = [
    ...await collectFiles('src', isSizeCheckedTest),
    ...await collectFiles('server', isSizeCheckedTest),
    ...await collectFiles('scripts', isSizeCheckedTest),
  ]
  const sources: Record<string, string> = Object.fromEntries(await Promise.all(testFiles.map(async (file) => [
    normalizeTestArchitecturePath(file),
    await readText(file),
  ])))
  const files: Record<string, ReturnType<typeof collectTestArchitectureMetrics>> = Object.fromEntries(Object.entries(sources).map(([file, source]) => [
    file,
    collectTestArchitectureMetrics(source),
  ]))
  const baseline = JSON.parse(await readText(testArchitectureBaselinePath))
  const approvals = JSON.parse(await readText(testArchitectureApprovalsPath))
  const semanticInventory = JSON.parse(await readText(testArchitectureSemanticInventoryPath))
  failures.push(...checkTestArchitectureApprovalsEmpty(approvals))
  failures.push(...checkTestArchitectureBaselineEmpty(baseline))
  failures.push(...checkTestArchitectureOwnership(baseline).failures)
  const result = checkTestArchitectureBaseline({ files, baseline })
  failures.push(...result.failures)
  warnings.push(...result.warnings)

  const semanticInteractions = Object.fromEntries(
    Object.entries(files)
      .filter(([, metrics]) => metrics.mockMetadataObservations > 0)
      .map(([file, metrics]) => [file, metrics.mockMetadataObservations]),
  )
  const persistenceCandidates = Object.fromEntries(
    Object.entries(sources)
      .map(([file, source]) => [file, collectPersistenceHeuristicSignals(source)] as const)
      .filter(([, signals]) => hasPersistenceContractSignals(signals)),
  )
  failures.push(...checkTestArchitectureSemanticInventory({
    inventory: semanticInventory,
    interactionObservations: semanticInteractions,
    persistenceCandidates,
  }))
  if (semanticInventory.mode === "enforced") {
    failures.push(...checkTestArchitectureMockMetadataObservations(files))
  }
  const semanticObservationCount = Object.values(semanticInteractions)
    .reduce((sum, count) => sum + count, 0)
  console.log(
    `${semanticInventory.mode === "enforced" ? "Enforced" : "Report-only"} test-architecture semantic inventory: ${semanticObservationCount} mock-metadata observation(s) in ${Object.keys(semanticInteractions).length} file(s); ${Object.keys(persistenceCandidates).length} classified persistence contract file(s)`,
  )

  const configuredRef = process.env.TEST_ARCHITECTURE_BASE_REF?.trim()
  const localBaselineChanged = !configuredRef && execFileSync(
    "git",
    ["status", "--porcelain", "--", testArchitectureBaselinePath],
    { cwd: root, encoding: "utf8" },
  ).trim().length > 0
  const comparisonRef = configuredRef || (localBaselineChanged ? "HEAD" : "")
  if (comparisonRef) {
    let previousBaselineSource: string | null = null
    try {
      previousBaselineSource = execFileSync(
        "git",
        ["show", `${comparisonRef}:${testArchitectureBaselinePath}`],
        { cwd: root, encoding: "utf8" },
      )
    } catch {
      try {
        execFileSync("git", ["rev-parse", "--verify", comparisonRef], {
          cwd: root,
          encoding: "utf8",
          stdio: "pipe",
        })
        warnings.push(`no test-architecture baseline exists at ${comparisonRef}; treating this as the initial ratchet establishment`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        failures.push(`could not resolve the test-architecture comparison ref ${comparisonRef}: ${detail}`)
      }
    }
    if (previousBaselineSource) {
      try {
        const previousBaseline = JSON.parse(previousBaselineSource)
        failures.push(...checkTestArchitectureBaselineGrowth({ previousBaseline, baseline }))
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        failures.push(`could not parse the test-architecture baseline from ${comparisonRef}: ${detail}`)
      }
    }
  }
}

async function checkStaticDesignPolicies() {
  const componentPaths = await collectFiles('src', (relativePath) =>
    /\.(?:jsx|tsx)$/.test(relativePath) && !relativePath.includes('.test.'),
  )
  const componentFiles = await Promise.all(
    componentPaths.map(async (relativePath) => ({
      path: relativePath,
      source: await readText(relativePath),
    })),
  )
  failures.push(...findForbiddenSourcePatterns({
    files: componentFiles,
    rules: [{
      name: 'retired design utility',
      pattern: /(?<![\w-])(?:bg|text|border|ring|fill|stroke|shadow)-(?:surface-hover|surface|elevated|modal)(?![\w-])/,
    }],
  }))

  // These shared controls must follow the owner-selected accent token. A frozen
  // lavender literal here would make user accent changes stop propagating.
  const accentTokenPaths = [
    'src/components/ui/button.tsx',
    'src/components/ui/switch.tsx',
    'src/components/shared/EmptyStateSplash.tsx',
  ]
  const accentTokenFiles = await Promise.all(
    accentTokenPaths.map(async (relativePath) => ({
      path: relativePath,
      source: await readText(relativePath),
    })),
  )
  failures.push(...findForbiddenSourcePatterns({
    files: accentTokenFiles,
    rules: [
      { name: 'frozen accent literal', pattern: /#cba6da/i },
      { name: 'frozen accent literal', pattern: /203,\s*166,\s*218/ },
    ],
  }))
}

await checkIgnoredKnowledge()
await checkAgentsMap()
await checkHistoricalDocsCleanup()
await checkAreaMaps()
await checkImportBoundariesAcrossDomains()
checkModuleReachability()
checkExportReachability()
await checkSourceFileSizes()
await checkTestFileSizes()
await checkTestSourcePolicies()
await checkTestArchitecture()
await checkStaticDesignPolicies()

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
