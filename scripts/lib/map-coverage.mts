const SOURCE_RE = /\.(ts|tsx)$/
const TEST_RE = /\.test\.(ts|tsx)$/

interface AreaMap {
  dir: string
  text: string
}

interface MapCheckResult {
  failures: string[]
  warnings: string[]
}

export function isRequiredEntry(relPath: string): boolean {
  return SOURCE_RE.test(relPath) && !TEST_RE.test(relPath)
}

export function scopeOf(mapDir: string, mapDirs: string[], files: string[]): string[] {
  const nested = mapDirs.filter((d) => d !== mapDir && d.startsWith(`${mapDir}/`))
  return files.filter(
    (f) => f.startsWith(`${mapDir}/`) && !nested.some((d) => f.startsWith(`${d}/`)),
  )
}

function namedFiles(mapText: string): string[] {
  return [...mapText.matchAll(/`([^`\s]+\.(?:ts|tsx))`/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
}

export function checkMaps({ files, maps }: { files: string[]; maps: AreaMap[] }): MapCheckResult {
  const failures: string[] = []
  const warnings: string[] = []
  const fileSet = new Set(files)
  const mapDirs = maps.map((m) => m.dir)
  for (const { dir, text } of maps) {
    const scope = scopeOf(dir, mapDirs, files).filter(isRequiredEntry)
    for (const file of scope) {
      const base = file.slice(file.lastIndexOf("/") + 1)
      if (!text.includes(base)) failures.push(`${dir}/CLAUDE.md missing entry for ${file}`)
    }
    for (const named of namedFiles(text)) {
      if (!fileSet.has(`${dir}/${named}`) && !fileSet.has(named)) {
        failures.push(`${dir}/CLAUDE.md names missing file ${named}`)
      }
    }
    if (scope.length > 60 && !text.includes("map-scope-warning: accepted")) {
      warnings.push(
        `${dir}/CLAUDE.md covers ${scope.length} files; consider a sub-map (or mark <!-- map-scope-warning: accepted -->)`,
      )
    }
  }
  return { failures, warnings }
}

export function missingDocPaths(docText: string, files: string[]): string[] {
  const fileSet = new Set(files)
  const out: string[] = []
  for (const m of docText.matchAll(/`([^`\s:]+\/[^`\s:]+\.(?:ts|tsx))(?::[\w$.]+)?`/g)) {
    const namedPath = m[1]
    if (namedPath && !fileSet.has(namedPath)) out.push(namedPath)
  }
  return [...new Set(out)]
}

export function uncoveredThresholdViolations({ files, mapDirs, threshold = 20 }: {
  files: string[]
  mapDirs: string[]
  threshold?: number
}): string[] {
  const directCounts = new Map<string, number>()
  for (const f of files) {
    if (!isRequiredEntry(f)) continue
    const dir = f.slice(0, f.lastIndexOf("/"))
    directCounts.set(dir, (directCounts.get(dir) ?? 0) + 1)
  }
  const covered = (dir: string) => mapDirs.some((d) => dir === d || dir.startsWith(`${d}/`))
  return [...directCounts]
    .filter(([dir, count]) => count >= threshold && !covered(dir))
    .map(([dir, count]) => `${dir} has ${count} non-test source files and no CLAUDE.md map coverage`)
    .sort()
}
