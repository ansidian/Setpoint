interface TreeNode {
  name: string
  children: Map<string, TreeNode>
}

interface RouteRow {
  method: string
  path: string
  file: string
}

interface MigrationSource {
  file: string
  source: string
}

interface MigrationTable {
  table: string
  migrations: string[]
}

interface HookRow {
  file: string
  export: string
}

export function formatDirectoryTree(rootLabel: string, dirs: string[]): string {
  const root: TreeNode = { name: "", children: new Map() }
  for (const dir of dirs) {
    const parts = dir.split("/")
    let node = root
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map() })
      }
      const child = node.children.get(part)
      if (!child) throw new Error(`Missing tree node for ${part}`)
      node = child
    }
  }

  const lines = [rootLabel]
  const walk = (node: TreeNode, prefix: string) => {
    const entries = Array.from(node.children.values())
    entries.forEach((child, i) => {
      const isLast = i === entries.length - 1
      const branch = isLast ? "└── " : "├── "
      lines.push(`${prefix}${branch}${child.name}/`)
      const nextPrefix = prefix + (isLast ? "    " : "│   ")
      walk(child, nextPrefix)
    })
  }
  walk(root, "")
  return lines.join("\n")
}

export function extractHookExport(source: string): string | null {
  const allNamed = [
    ...source.matchAll(
      /export\s+(?:default\s+)?(?:function|const|let|class)\s+(\w+)/g,
    ),
  ].map((m) => m[1])
  const hookFirst = allNamed.find((name): name is string => name !== undefined && /^use[A-Z]/.test(name))
  if (hookFirst) return hookFirst
  if (allNamed.length > 0) return allNamed[0] ?? null
  const defaultRef = source.match(/export\s+default\s+(\w+)\s*;?\s*$/m)
  if (defaultRef) return defaultRef[1] ?? null
  return null
}

export function extractMounts(source: string): Array<{ prefix: string; file: string }> {
  const imports = new Map<string, string>()
  const importRe = /import\s+(\w+)\s+from\s+(['"])([^'"]+)\2/g
  for (const m of source.matchAll(importRe)) {
    const name = m[1]
    const file = m[3]
    if (name && file) imports.set(name, file)
  }

  const mounts: Array<{ prefix: string; file: string }> = []
  const useRe = /app\.use\s*\(\s*(['"`])([^'"`]+)\1\s*,([^)]*\([^)]*\)\s*,)?\s*(\w+)\s*\)/g
  for (const m of source.matchAll(useRe)) {
    const importName = m[4]
    const prefix = m[2]
    const file = importName ? imports.get(importName) : undefined
    if (file && prefix) mounts.push({ prefix, file })
  }
  return mounts
}

export function extractRoutes(source: string, file: string): RouteRow[] {
  const routes: RouteRow[] = []
  const methodRe = /\brouter\.(get|post|put|patch|delete|head|options)\s*\(\s*(['"`])([^'"`]+)\2/gi
  for (const m of source.matchAll(methodRe)) {
    const method = m[1]
    const routePath = m[3]
    if (method && routePath) routes.push({ method: method.toUpperCase(), path: routePath, file })
  }
  return routes
}

// SQL comments can mention "CREATE TABLE ..." as prose (023 does), so strip
// them before matching statements.
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
}

export function extractMigrationTables(migrations: MigrationSource[]): MigrationTable[] {
  const map = new Map<string, string[]>()
  const renames = new Map<string, string>()
  const createRe = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi
  const alterRe = /ALTER\s+TABLE\s+(\w+)/gi
  const renameRe = /ALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)/gi

  const record = (table: string | undefined, file: string) => {
    if (!table) return
    if (!map.has(table)) map.set(table, [])
    const list = map.get(table)
    if (!list) return
    if (list[list.length - 1] !== file) list.push(file)
  }

  for (const { file, source } of migrations) {
    const sql = stripSqlComments(source)
    for (const m of sql.matchAll(createRe)) record(m[1], file)
    for (const m of sql.matchAll(alterRe)) record(m[1], file)
    for (const m of sql.matchAll(renameRe)) {
      const from = m[1]
      const to = m[2]
      if (from && to) renames.set(from, to)
    }
  }

  for (const [from, to] of renames) {
    if (!map.has(from)) continue
    const merged = map.get(to) ?? []
    for (const file of map.get(from) ?? []) {
      if (!merged.includes(file)) merged.push(file)
    }
    map.set(to, merged)
    map.delete(from)
  }

  return Array.from(map, ([table, migrations]) => ({ table, migrations })).sort(
    (a, b) => a.table.localeCompare(b.table),
  )
}

export function applyMarkerBlock(content: string, markerName: string, generatedBody: string): string {
  const begin = `<!-- BEGIN:${markerName} -->`
  const end = `<!-- END:${markerName} -->`
  const beginIdx = content.indexOf(begin)
  const endIdx = content.indexOf(end)
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(`applyMarkerBlock: markers for "${markerName}" missing or out of order`)
  }
  const before = content.slice(0, beginIdx + begin.length)
  const after = content.slice(endIdx)
  return `${before}\n${generatedBody}\n${after}`
}

export function renderRouteTable(rows: RouteRow[]): string {
  if (rows.length === 0) return "_No routes detected._"
  const lines = ["| Method | Path | File |", "|--------|------|------|"]
  for (const r of rows) lines.push(`| ${r.method} | \`${r.path}\` | \`${r.file}\` |`)
  return lines.join("\n")
}

export function renderDbTable(tables: MigrationTable[]): string {
  if (tables.length === 0) return "_No tables detected._"
  const lines = ["| Table | Migrations |", "|-------|------------|"]
  for (const t of tables) {
    const migs = t.migrations.map((m) => `\`${m}\``).join(", ")
    lines.push(`| \`${t.table}\` | ${migs} |`)
  }
  return lines.join("\n")
}

export function renderHooksList(rows: HookRow[]): string {
  if (rows.length === 0) return "_No hooks detected._"
  const lines = ["| Export | File |", "|--------|------|"]
  for (const r of rows) lines.push(`| \`${r.export}\` | \`${r.file}\` |`)
  return lines.join("\n")
}

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

const SKIP_DIRS = new Set(["node_modules", "dist", "dist-demo", ".git"])

// path.relative() returns OS-native separators; rendered output (and the
// "/"-split tree formatter) must stay POSIX-style regardless of platform.
function toPosixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/")
}

async function listSubdirs(dirAbs: string, maxDepth: number, baseAbs = dirAbs, currentDepth = 1): Promise<string[]> {
  const result: string[] = []
  let entries
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true })
  } catch {
    return result
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue
    const childAbs = path.join(dirAbs, entry.name)
    result.push(toPosixRelative(baseAbs, childAbs))
    if (currentDepth < maxDepth) {
      result.push(...(await listSubdirs(childAbs, maxDepth, baseAbs, currentDepth + 1)))
    }
  }
  return result
}

async function findFiles(
  dirAbs: string,
  predicate: (absolutePath: string, name: string) => boolean,
  results: string[] = [],
): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true })
  } catch {
    return results
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const childAbs = path.join(dirAbs, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue
      await findFiles(childAbs, predicate, results)
    } else if (predicate(childAbs, entry.name)) {
      results.push(childAbs)
    }
  }
  return results
}

export async function regenerateArchitecture({ rootDir }: { rootDir: string }): Promise<string> {
  const srcDirs = await listSubdirs(path.join(rootDir, "src"), 3)
  const serverDirs = await listSubdirs(path.join(rootDir, "server"), 3)
  const treeBody = [
    "```",
    formatDirectoryTree("src/", srcDirs),
    "",
    formatDirectoryTree("server/", serverDirs),
    "```",
  ].join("\n")

  const indexPath = path.join(rootDir, "server/index.ts")
  const indexSource = await fs.readFile(indexPath, "utf8")
  const mounts = extractMounts(indexSource)
  const routeFiles = await findFiles(
    path.join(rootDir, "server/routes"),
    (_abs, name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  )
  const filePrefix = new Map()
  for (const m of mounts) {
    const fileAbs = path.resolve(path.join(rootDir, "server"), m.file)
    filePrefix.set(fileAbs, m.prefix)
    if (fileAbs.endsWith(`${path.sep}index.ts`)) {
      const dir = path.dirname(fileAbs)
      for (const f of routeFiles) {
        if (f.startsWith(dir + path.sep)) filePrefix.set(f, m.prefix)
      }
    }
  }
  const routeRows: RouteRow[] = []
  for (const fileAbs of routeFiles) {
    const prefix = filePrefix.get(fileAbs) ?? ""
    const source = await fs.readFile(fileAbs, "utf8")
    const rel = toPosixRelative(rootDir, fileAbs)
    for (const r of extractRoutes(source, rel)) {
      routeRows.push({ method: r.method, path: prefix + r.path, file: rel })
    }
  }
  routeRows.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  )
  const routeBody = renderRouteTable(routeRows)

  const migrationDir = path.join(rootDir, "server/db/migrations")
  const migrationFiles = (await fs.readdir(migrationDir))
    .filter((f) => f.endsWith(".sql"))
    .sort()
  const migrationSources = await Promise.all(
    migrationFiles.map(async (f) => ({
      file: f,
      source: await fs.readFile(path.join(migrationDir, f), "utf8"),
    })),
  )
  const tables = extractMigrationTables(migrationSources)
  const dbBody = renderDbTable(tables)

  const hookFiles: string[] = []
  for (const baseDir of ["src/hooks", "src/components"]) {
    hookFiles.push(
      ...(await findFiles(
        path.join(rootDir, baseDir),
        (_abs, name) => /^use[A-Z]\w*\.(?:ts|tsx)$/.test(name) && !/\.test\.(?:ts|tsx)$/.test(name),
      )),
    )
  }
  hookFiles.sort()
  const hookRows: HookRow[] = []
  for (const fileAbs of hookFiles) {
    const source = await fs.readFile(fileAbs, "utf8")
    const exportName = extractHookExport(source)
    const rel = toPosixRelative(rootDir, fileAbs)
    hookRows.push({ file: rel, export: exportName ?? "" })
  }
  const hooksBody = renderHooksList(hookRows)

  let content = await fs.readFile(path.join(rootDir, "ARCHITECTURE.md"), "utf8")
  content = applyMarkerBlock(content, "tree", treeBody)
  content = applyMarkerBlock(content, "routes", routeBody)
  content = applyMarkerBlock(content, "db", dbBody)
  content = applyMarkerBlock(content, "hooks", hooksBody)
  return content
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const rootDir = process.cwd()
  const start = performance.now()
  const next = await regenerateArchitecture({ rootDir })
  const target = path.join(rootDir, "ARCHITECTURE.md")
  const current = await fs.readFile(target, "utf8")
  const elapsed = Math.round(performance.now() - start)
  if (current !== next) {
    await fs.writeFile(target, next)
    console.log(`[regen-architecture] updated ARCHITECTURE.md (${elapsed}ms)`)
  } else {
    console.log(`[regen-architecture] no changes (${elapsed}ms)`)
  }
}
