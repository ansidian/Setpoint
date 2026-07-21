import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { analyzeModuleReachability, type ModuleSourceFile } from "./lib/module-reachability.mts"

interface ReachabilityConfig {
  entrypoints: string[]
  exemptions: Record<string, string>
}

const root = process.cwd()
const configPath = "scripts/lib/module-reachability-baseline.json"
const jsonOutput = process.argv.includes("--json")
const reportOnly = process.argv.includes("--report-only")

function normalize(relativePath: string): string {
  return relativePath.split(path.sep).join("/")
}

function isSourceModule(relativePath: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/.test(relativePath)
}

function isVitestFile(relativePath: string): boolean {
  return /\.(?:test|spec)\.(?:ts|tsx|mts|cts)$/.test(relativePath)
    && /^(?:src|server|scripts)\//.test(relativePath)
}

async function exists(relativePath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

async function readModule(relativePath: string): Promise<ModuleSourceFile> {
  return {
    path: relativePath,
    source: await fs.readFile(path.join(root, relativePath), "utf8"),
  }
}

const config = JSON.parse(await fs.readFile(path.join(root, configPath), "utf8")) as ReachabilityConfig
const listedPaths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
)
  .split(/\r?\n/)
  .filter(Boolean)
  .map(normalize)

const currentPaths: string[] = []
for (const relativePath of listedPaths) {
  if (await exists(relativePath)) currentPaths.push(relativePath)
}

const testPaths = currentPaths.filter(isVitestFile)
const productionPaths = currentPaths.filter((relativePath) => (
  isSourceModule(relativePath)
  && !isVitestFile(relativePath)
  && !relativePath.startsWith("e2e/")
))

const [productionFiles, testFiles] = await Promise.all([
  Promise.all(productionPaths.map(readModule)),
  Promise.all(testPaths.map(readModule)),
])
const result = analyzeModuleReachability({
  productionFiles,
  testFiles,
  entrypoints: config.entrypoints,
  exemptions: config.exemptions,
})

const summary = {
  productionModules: productionFiles.length,
  testFiles: testFiles.length,
  entrypoints: config.entrypoints.length,
  reachable: result.reachable.length,
  exempt: result.exempt.length,
  candidateUnreachable: result.candidateUnreachable.length,
  testOnlyTargets: result.testOnlyTargets.length,
  unresolvedInternalEdges: result.unresolvedInternalEdges.length,
  missingEntrypoints: result.missingEntrypoints.length,
  staleExemptions: result.staleExemptions.length,
}

if (jsonOutput) {
  console.log(JSON.stringify({ summary, ...result }, null, 2))
} else {
  console.log(`Module reachability: ${JSON.stringify(summary)}`)
  for (const modulePath of result.candidateUnreachable) {
    const marker = result.testOnlyTargets.includes(modulePath) ? " [test-only target]" : ""
    console.log(`  candidate: ${modulePath}${marker}`)
  }
  for (const edge of result.unresolvedInternalEdges) {
    console.log(`  unresolved: ${edge.consumer} -> ${edge.specifier}`)
  }
  for (const entrypoint of result.missingEntrypoints) {
    console.log(`  missing entrypoint: ${entrypoint}`)
  }
  for (const exemption of result.staleExemptions) {
    console.log(`  stale exemption: ${exemption}`)
  }
}

const hasFailures = result.candidateUnreachable.length > 0
  || result.unresolvedInternalEdges.length > 0
  || result.missingEntrypoints.length > 0
  || result.staleExemptions.length > 0
if (hasFailures && !reportOnly) process.exit(1)
