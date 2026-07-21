import { describe, it, expect } from "vitest"
import {
  applyMarkerBlock,
  extractHookExport,
  extractMigrationTables,
  extractMounts,
  extractRoutes,
  formatDirectoryTree,
} from "./regen-architecture.mts"

describe("applyMarkerBlock", () => {
  it("replaces content between BEGIN/END markers, preserving surrounding text", () => {
    const input = [
      "before text",
      "<!-- BEGIN:tree -->",
      "old generated content",
      "<!-- END:tree -->",
      "after text",
    ].join("\n")

    const result = applyMarkerBlock(input, "tree", "new generated content")

    expect(result).toBe(
      [
        "before text",
        "<!-- BEGIN:tree -->",
        "new generated content",
        "<!-- END:tree -->",
        "after text",
      ].join("\n"),
    )
  })

  it("is idempotent: applying the same body twice produces identical output", () => {
    const input = [
      "<!-- BEGIN:routes -->",
      "<!-- END:routes -->",
    ].join("\n")

    const once = applyMarkerBlock(input, "routes", "row a\nrow b")
    const twice = applyMarkerBlock(once, "routes", "row a\nrow b")

    expect(twice).toBe(once)
  })

  it("throws a descriptive error when markers are missing", () => {
    expect(() => applyMarkerBlock("no markers here", "tree", "x")).toThrow(
      /markers for "tree"/,
    )
  })
})

describe("extractMigrationTables", () => {
  it("extracts a single CREATE TABLE name from a migration file", () => {
    const result = extractMigrationTables([
      { file: "001_init.sql", source: "CREATE TABLE IF NOT EXISTS ea_accounts (id TEXT);" },
    ])
    expect(result).toEqual([
      { table: "ea_accounts", migrations: ["001_init.sql"] },
    ])
  })

  it("treats CREATE VIRTUAL TABLE as a table declaration", () => {
    const result = extractMigrationTables([
      {
        file: "001_init.sql",
        source: "CREATE VIRTUAL TABLE IF NOT EXISTS ea_email_fts USING fts5(subject);",
      },
    ])
    expect(result).toEqual([
      { table: "ea_email_fts", migrations: ["001_init.sql"] },
    ])
  })

  it("associates ALTER TABLE migrations with the table they touch", () => {
    const result = extractMigrationTables([
      { file: "001_init.sql", source: "CREATE TABLE IF NOT EXISTS ea_settings (id TEXT);" },
      { file: "003_alter.sql", source: "ALTER TABLE ea_settings ADD COLUMN foo TEXT;" },
    ])
    expect(result).toEqual([
      { table: "ea_settings", migrations: ["001_init.sql", "003_alter.sql"] },
    ])
  })

  it("treats a RENAME TO target as the canonical table name", () => {
    const result = extractMigrationTables([
      {
        file: "014_rename.sql",
        source: [
          "CREATE TABLE IF NOT EXISTS ea_completed_tasks_next (id TEXT);",
          "ALTER TABLE ea_completed_tasks_next RENAME TO ea_completed_tasks;",
        ].join("\n"),
      },
    ])
    expect(result).toEqual([
      { table: "ea_completed_tasks", migrations: ["014_rename.sql"] },
    ])
  })

  it("ignores CREATE/ALTER TABLE phrases inside SQL comments", () => {
    const result = extractMigrationTables([
      {
        file: "023_rebuild.sql",
        source: [
          "-- CREATE TABLE IF NOT EXISTS silently no-opped against the old shape. Rebuild",
          "/* ALTER TABLE ghost_block is also just prose */",
          "CREATE TABLE ea_pinned_emails (id TEXT);",
        ].join("\n"),
      },
    ])
    expect(result).toEqual([
      { table: "ea_pinned_emails", migrations: ["023_rebuild.sql"] },
    ])
  })

  it("returns tables sorted alphabetically for stable output", () => {
    const result = extractMigrationTables([
      { file: "001_init.sql", source: "CREATE TABLE IF NOT EXISTS zeta (a TEXT); CREATE TABLE IF NOT EXISTS alpha (a TEXT);" },
    ])
    expect(result.map((r) => r.table)).toEqual(["alpha", "zeta"])
  })
})

describe("extractRoutes", () => {
  it("extracts router.METHOD(path) calls from a route file", () => {
    const source = [
      'import { Router } from "express";',
      'const router = Router();',
      'router.get("/check", handler);',
      'router.post("/login", handler);',
      'export default router;',
    ].join("\n")
    const result = extractRoutes(source, "server/routes/auth.ts")
    expect(result).toEqual([
      { method: "GET", path: "/check", file: "server/routes/auth.ts" },
      { method: "POST", path: "/login", file: "server/routes/auth.ts" },
    ])
  })
})

describe("formatDirectoryTree", () => {
  it("formats a flat directory list with box-drawing characters", () => {
    const result = formatDirectoryTree("src/", ["auth", "components", "hooks"])
    expect(result).toBe(
      ["src/", "├── auth/", "├── components/", "└── hooks/"].join("\n"),
    )
  })

  it("nests children under their parents with vertical pipes", () => {
    const result = formatDirectoryTree("src/", [
      "auth",
      "components",
      "components/bills",
      "components/briefing",
      "hooks",
    ])
    expect(result).toBe(
      [
        "src/",
        "├── auth/",
        "├── components/",
        "│   ├── bills/",
        "│   └── briefing/",
        "└── hooks/",
      ].join("\n"),
    )
  })
})

describe("extractHookExport", () => {
  it("returns the first export-function name", () => {
    const source = "export function useFoo() { return 1 }"
    expect(extractHookExport(source)).toBe("useFoo")
  })

  it("returns the first export-const name", () => {
    const source = "export const useBar = () => 1"
    expect(extractHookExport(source)).toBe("useBar")
  })

  it("returns null when no exported hook is found", () => {
    expect(extractHookExport("const x = 1")).toBe(null)
  })

  it("returns the name of an `export default function NAME`", () => {
    expect(extractHookExport("export default function useInbox() {}")).toBe("useInbox")
  })

  it("returns the reference name of an `export default identifier`", () => {
    expect(extractHookExport("function useFoo() {}\nexport default useFoo")).toBe("useFoo")
  })

  it("prefers a `use*` export over a helper export earlier in the file", () => {
    const source = [
      "export function buildPayload() {}",
      "export default function useCalendarQuickActions() {}",
    ].join("\n")
    expect(extractHookExport(source)).toBe("useCalendarQuickActions")
  })
})

describe("extractMounts", () => {
  it("pairs app.use mount prefixes with the file imported under that name", () => {
    const source = [
      'import authRoutes from "./routes/auth.ts";',
      'import briefingRoutes from "./routes/briefing/index.ts";',
      'app.use("/api/auth", authRoutes);',
      'app.use("/api/briefing", briefingRoutes);',
    ].join("\n")
    expect(extractMounts(source)).toEqual([
      { prefix: "/api/auth", file: "./routes/auth.ts" },
      { prefix: "/api/briefing", file: "./routes/briefing/index.ts" },
    ])
  })

  it("handles an intermediate middleware argument", () => {
    const source = [
      'import webhookRoutes from "./routes/webhook.ts";',
      'app.use("/api/webhook", express.raw({ type: "*/*" }), webhookRoutes);',
    ].join("\n")
    expect(extractMounts(source)).toEqual([
      { prefix: "/api/webhook", file: "./routes/webhook.ts" },
    ])
  })
})
