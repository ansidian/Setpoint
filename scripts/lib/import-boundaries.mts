import path from "node:path"

const IMPORT_SPEC_RE =
  /(?:import\s+[^'"]*?from|export\s+\*\s+from|export\s+\{[^}]*\}\s*from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g

interface SourceFile {
  path: string
  source: string
}

interface BoundaryEdge {
  consumer: string
  target: string
}

interface BoundaryCheckResult {
  failures: string[]
  warnings: string[]
}

function domainOf(relPath: string, domains: string[]): string | null {
  const m = relPath.match(/^server\/([^/]+)\//)
  const domain = m?.[1]
  return domain && domains.includes(domain) ? domain : null
}

function isExempt(relPath: string): boolean {
  return (
    /\.test\.(ts|mts|tsx)$/.test(relPath) ||
    relPath.includes(".test-utils.") ||
    relPath.includes("/test-utils/") ||
    relPath.startsWith("server/scripts/")
  )
}

export function collectCrossDomainEdges({ files, domains }: { files: SourceFile[]; domains: string[] }): BoundaryEdge[] {
  const edges: BoundaryEdge[] = []
  for (const { path: relPath, source } of files) {
    if (isExempt(relPath)) continue
    const consumerDomain = domainOf(relPath, domains)
    for (const m of source.matchAll(IMPORT_SPEC_RE)) {
      const spec = m[2]
      if (!spec) continue
      if (!spec.startsWith(".")) continue
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), spec))
      const targetDomain = domainOf(target, domains)
      if (!targetDomain || targetDomain === consumerDomain) continue
      edges.push({ consumer: relPath, target })
    }
  }
  return edges
}

export function checkImportBoundaries({
  edges,
  entries,
  baseline,
}: {
  edges: BoundaryEdge[]
  entries: Record<string, string[]>
  baseline: string[]
}): BoundaryCheckResult {
  const failures: string[] = []
  const usedBaseline = new Set<string>()
  const domains = Object.keys(entries)

  for (const { consumer, target } of edges) {
    const targetDomain = domainOf(target, domains)
    if (consumer.startsWith("server/platform/")) {
      failures.push(
        `${consumer} imports ${target}: platform is shared infrastructure and must never import a domain`,
      )
      continue
    }
    if (!targetDomain) continue
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
