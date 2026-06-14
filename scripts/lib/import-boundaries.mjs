import path from "node:path"

const IMPORT_SPEC_RE =
  /(?:import\s+[^'"]*?from|export\s+\*\s+from|export\s+\{[^}]*\}\s*from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g

function domainOf(relPath, domains) {
  const m = relPath.match(/^server\/([^/]+)\//)
  return m && domains.includes(m[1]) ? m[1] : null
}

function isExempt(relPath) {
  return (
    /\.test\.(js|mjs|jsx)$/.test(relPath) ||
    relPath.includes(".test-utils.") ||
    relPath.includes("/test-utils/") ||
    relPath.startsWith("server/scripts/")
  )
}

export function collectCrossDomainEdges({ files, domains }) {
  const edges = []
  for (const { path: relPath, source } of files) {
    if (isExempt(relPath)) continue
    const consumerDomain = domainOf(relPath, domains)
    for (const m of source.matchAll(IMPORT_SPEC_RE)) {
      const spec = m[2]
      if (!spec.startsWith(".")) continue
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), spec))
      const targetDomain = domainOf(target, domains)
      if (!targetDomain || targetDomain === consumerDomain) continue
      edges.push({ consumer: relPath, target })
    }
  }
  return edges
}

export function checkImportBoundaries({ edges, entries, baseline }) {
  const failures = []
  const usedBaseline = new Set()
  const domains = Object.keys(entries)

  for (const { consumer, target } of edges) {
    const targetDomain = domainOf(target, domains)
    if (consumer.startsWith("server/platform/")) {
      failures.push(
        `${consumer} imports ${target}: platform is shared infrastructure and must never import a domain`,
      )
      continue
    }
    const allowed = entries[targetDomain] ?? []
    const targetRel = target.slice(`server/${targetDomain}/`.length)
    if (allowed.includes("*") || allowed.includes(targetRel)) continue
    const key = `${consumer} -> ${target}`
    if (baseline.includes(key)) {
      usedBaseline.add(key)
      continue
    }
    failures.push(
      `${key} crosses the ${targetDomain} boundary; import a documented entry module (see server/${targetDomain}/CLAUDE.md) or add the edge to scripts/lib/import-boundaries-baseline.json with justification`,
    )
  }

  const warnings = baseline
    .filter((key) => !usedBaseline.has(key))
    .map((key) => `baseline edge "${key}" is no longer present; remove it from import-boundaries-baseline.json`)

  return { failures, warnings }
}
