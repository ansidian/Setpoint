const SOURCE_RE = /\.(js|jsx|ts|tsx)$/
const TEST_RE = /\.test\.(js|jsx|ts|tsx)$/

export function isRequiredEntry(relPath) {
  return SOURCE_RE.test(relPath) && !TEST_RE.test(relPath)
}

export function scopeOf(mapDir, mapDirs, files) {
  const nested = mapDirs.filter((d) => d !== mapDir && d.startsWith(`${mapDir}/`))
  return files.filter(
    (f) => f.startsWith(`${mapDir}/`) && !nested.some((d) => f.startsWith(`${d}/`)),
  )
}

function namedFiles(mapText) {
  return [...mapText.matchAll(/`([^`\s]+\.(?:js|jsx|ts|tsx))`/g)].map((m) => m[1])
}

export function checkMaps({ files, maps }) {
  const failures = []
  const warnings = []
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

export function missingDocPaths(docText, files) {
  const fileSet = new Set(files)
  const out = []
  for (const m of docText.matchAll(/`([^`\s:]+\/[^`\s:]+\.(?:js|jsx|ts|tsx))(?::[\w$.]+)?`/g)) {
    if (!fileSet.has(m[1])) out.push(m[1])
  }
  return [...new Set(out)]
}

export function uncoveredThresholdViolations({ files, mapDirs, threshold = 20 }) {
  const directCounts = new Map()
  for (const f of files) {
    if (!isRequiredEntry(f)) continue
    const dir = f.slice(0, f.lastIndexOf("/"))
    directCounts.set(dir, (directCounts.get(dir) ?? 0) + 1)
  }
  const covered = (dir) => mapDirs.some((d) => dir === d || dir.startsWith(`${d}/`))
  return [...directCounts]
    .filter(([dir, count]) => count >= threshold && !covered(dir))
    .map(([dir, count]) => `${dir} has ${count} non-test source files and no CLAUDE.md map coverage`)
    .sort()
}
