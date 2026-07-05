export function formatDirectoryTree(rootLabel, dirs) {
  const root = { name: "", children: new Map() }
  for (const dir of dirs) {
    const parts = dir.split("/")
    let node = root
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map() })
      }
      node = node.children.get(part)
    }
  }

  const lines = [rootLabel]
  const walk = (node, prefix) => {
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

export function extractHookExport(source) {
  const allNamed = [
    ...source.matchAll(
      /export\s+(?:default\s+)?(?:function|const|let|class)\s+(\w+)/g,
    ),
  ].map((m) => m[1])
  const hookFirst = allNamed.find((name) => /^use[A-Z]/.test(name))
  if (hookFirst) return hookFirst
  if (allNamed.length > 0) return allNamed[0]
  const defaultRef = source.match(/export\s+default\s+(\w+)\s*;?\s*$/m)
  if (defaultRef) return defaultRef[1]
  return null
}

export function extractMounts(source) {
  const imports = new Map()
  const importRe = /import\s+(\w+)\s+from\s+(['"])([^'"]+)\2/g
  for (const m of source.matchAll(importRe)) imports.set(m[1], m[3])

  const mounts = []
  const useRe = /app\.use\s*\(\s*(['"`])([^'"`]+)\1\s*,([^)]*\([^)]*\)\s*,)?\s*(\w+)\s*\)/g
  for (const m of source.matchAll(useRe)) {
    const file = imports.get(m[4])
    if (file) mounts.push({ prefix: m[2], file })
  }
  return mounts
}

export function extractRoutes(source, file) {
  const routes = []
  const methodRe = /\brouter\.(get|post|put|patch|delete|head|options)\s*\(\s*(['"`])([^'"`]+)\2/gi
  for (const m of source.matchAll(methodRe)) {
    routes.push({ method: m[1].toUpperCase(), path: m[3], file })
  }
  return routes
}

// SQL comments can mention "CREATE TABLE ..." as prose (023 does), so strip
// them before matching statements.
function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
}

export function extractMigrationTables(migrations) {
  const map = new Map()
  const renames = new Map()
  const createRe = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi
  const alterRe = /ALTER\s+TABLE\s+(\w+)/gi
  const renameRe = /ALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)/gi

  const record = (table, file) => {
    if (!map.has(table)) map.set(table, [])
    const list = map.get(table)
    if (list[list.length - 1] !== file) list.push(file)
  }

  for (const { file, source } of migrations) {
    const sql = stripSqlComments(source)
    for (const m of sql.matchAll(createRe)) record(m[1], file)
    for (const m of sql.matchAll(alterRe)) record(m[1], file)
    for (const m of sql.matchAll(renameRe)) renames.set(m[1], m[2])
  }

  for (const [from, to] of renames) {
    if (!map.has(from)) continue
    const merged = map.get(to) ?? []
    for (const file of map.get(from)) {
      if (!merged.includes(file)) merged.push(file)
    }
    map.set(to, merged)
    map.delete(from)
  }

  return Array.from(map, ([table, migrations]) => ({ table, migrations })).sort(
    (a, b) => a.table.localeCompare(b.table),
  )
}

export function applyMarkerBlock(content, markerName, generatedBody) {
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

export function renderRouteTable(rows) {
  if (rows.length === 0) return "_No routes detected._"
  const lines = ["| Method | Path | File |", "|--------|------|------|"]
  for (const r of rows) lines.push(`| ${r.method} | \`${r.path}\` | \`${r.file}\` |`)
  return lines.join("\n")
}

export function renderDbTable(tables) {
  if (tables.length === 0) return "_No tables detected._"
  const lines = ["| Table | Migrations |", "|-------|------------|"]
  for (const t of tables) {
    const migs = t.migrations.map((m) => `\`${m}\``).join(", ")
    lines.push(`| \`${t.table}\` | ${migs} |`)
  }
  return lines.join("\n")
}

export function renderHooksList(rows) {
  if (rows.length === 0) return "_No hooks detected._"
  const lines = ["| Export | File |", "|--------|------|"]
  for (const r of rows) lines.push(`| \`${r.export}\` | \`${r.file}\` |`)
  return lines.join("\n")
}

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const SKIP_DIRS = new Set(["node_modules", "dist", "dist-demo", ".git"])

async function listSubdirs(dirAbs, maxDepth, baseAbs = dirAbs, currentDepth = 1) {
  const result = []
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
    result.push(path.relative(baseAbs, childAbs))
    if (currentDepth < maxDepth) {
      result.push(...(await listSubdirs(childAbs, maxDepth, baseAbs, currentDepth + 1)))
    }
  }
  return result
}

async function findFiles(dirAbs, predicate, results = []) {
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

export async function regenerateArchitecture({ rootDir }) {
  const srcDirs = await listSubdirs(path.join(rootDir, "src"), 3)
  const serverDirs = await listSubdirs(path.join(rootDir, "server"), 3)
  const treeBody = [
    "```",
    formatDirectoryTree("src/", srcDirs),
    "",
    formatDirectoryTree("server/", serverDirs),
    "```",
  ].join("\n")

  const indexSource = await fs.readFile(path.join(rootDir, "server/index.js"), "utf8")
  const mounts = extractMounts(indexSource)
  const routeFiles = await findFiles(
    path.join(rootDir, "server/routes"),
    (_abs, name) => name.endsWith(".js") && !name.endsWith(".test.js"),
  )
  const filePrefix = new Map()
  for (const m of mounts) {
    const fileAbs = path.resolve(path.join(rootDir, "server"), m.file)
    filePrefix.set(fileAbs, m.prefix)
    if (fileAbs.endsWith(`${path.sep}index.js`)) {
      const dir = path.dirname(fileAbs)
      for (const f of routeFiles) {
        if (f.startsWith(dir + path.sep)) filePrefix.set(f, m.prefix)
      }
    }
  }
  const routeRows = []
  for (const fileAbs of routeFiles) {
    const prefix = filePrefix.get(fileAbs) ?? ""
    const source = await fs.readFile(fileAbs, "utf8")
    const rel = path.relative(rootDir, fileAbs)
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

  const hookFiles = []
  for (const baseDir of ["src/hooks", "src/components"]) {
    hookFiles.push(
      ...(await findFiles(
        path.join(rootDir, baseDir),
        (_abs, name) => /^use[A-Z]\w*\.js$/.test(name) && !name.endsWith(".test.js"),
      )),
    )
  }
  hookFiles.sort()
  const hookRows = []
  for (const fileAbs of hookFiles) {
    const source = await fs.readFile(fileAbs, "utf8")
    const exportName = extractHookExport(source)
    const rel = path.relative(rootDir, fileAbs)
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

const isMain = import.meta.url === `file://${process.argv[1]}`
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
