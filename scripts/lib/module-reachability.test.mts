import { describe, expect, it } from "vitest"
import {
  analyzeModuleReachability,
  collectModuleSpecifiers,
  resolveInternalModule,
} from "./module-reachability.mts"

describe("collectModuleSpecifiers", () => {
  it("collects static imports, re-exports, dynamic imports, and literal require calls", () => {
    const source = [
      'import value from "./value"',
      'import type { Shape } from "@/types"',
      'import "./side-effect"',
      'export { helper } from "./helper.js"',
      'export * from "./all"',
      'const lazy = import("./lazy")',
      'const legacy = require("./legacy")',
    ].join("\n")

    expect(collectModuleSpecifiers(source, "src/consumer.ts")).toEqual([
      "./value",
      "@/types",
      "./side-effect",
      "./helper.js",
      "./all",
      "./lazy",
      "./legacy",
    ])
  })

  it("ignores comments, ordinary strings, non-literal dynamic imports, and import.meta", () => {
    const source = [
      '// import "./commented"',
      'const text = "import(\\\"./string\\\")"',
      "const dynamic = import(variable)",
      "const url = import.meta.url",
    ].join("\n")

    expect(collectModuleSpecifiers(source, "src/consumer.ts")).toEqual([])
  })
})

describe("resolveInternalModule", () => {
  const modulePaths = new Set([
    "src/consumer.ts",
    "src/value.ts",
    "src/types/index.ts",
    "src/helper.ts",
    "src/Dashboard.bootState.ts",
    "server/index.ts",
  ])

  it("resolves relative, alias, extension-remapped, and index imports", () => {
    expect(resolveInternalModule({
      consumer: "src/consumer.ts",
      specifier: "./value",
      modulePaths,
    })).toBe("src/value.ts")
    expect(resolveInternalModule({
      consumer: "src/consumer.ts",
      specifier: "@/types",
      modulePaths,
    })).toBe("src/types/index.ts")
    expect(resolveInternalModule({
      consumer: "src/consumer.ts",
      specifier: "./helper.js",
      modulePaths,
    })).toBe("src/helper.ts")
    expect(resolveInternalModule({
      consumer: "src/consumer.ts",
      specifier: "./Dashboard.bootState",
      modulePaths,
    })).toBe("src/Dashboard.bootState.ts")
  })

  it("returns null for external packages and unresolved internal paths", () => {
    expect(resolveInternalModule({
      consumer: "src/consumer.ts",
      specifier: "react",
      modulePaths,
    })).toBeNull()
    expect(resolveInternalModule({
      consumer: "src/consumer.ts",
      specifier: "./missing",
      modulePaths,
    })).toBeNull()
  })
})

describe("analyzeModuleReachability", () => {
  it("traces cycles, records test-only targets, and honors explicit exemptions", () => {
    const result = analyzeModuleReachability({
      productionFiles: [
        { path: "src/main.ts", source: 'import "./a"' },
        { path: "src/a.ts", source: 'import "./b"' },
        { path: "src/b.ts", source: 'import "./a"' },
        { path: "src/test-only-target.ts", source: "export const value = 1" },
        { path: "server/scripts/operator.ts", source: "export const run = true" },
      ],
      testFiles: [
        { path: "src/test-only-target.test.ts", source: 'import "./test-only-target"' },
      ],
      entrypoints: ["src/main.ts"],
      exemptions: {
        "server/scripts/operator.ts": "documented standalone operator command",
      },
    })

    expect(result.reachable).toEqual(["src/a.ts", "src/b.ts", "src/main.ts"])
    expect(result.exempt).toEqual(["server/scripts/operator.ts"])
    expect(result.candidateUnreachable).toEqual(["src/test-only-target.ts"])
    expect(result.testOnlyTargets).toEqual(["src/test-only-target.ts"])
    expect(result.unresolvedInternalEdges).toEqual([])
  })

  it("reports missing entrypoints, stale exemptions, and unresolved internal imports", () => {
    const result = analyzeModuleReachability({
      productionFiles: [
        { path: "src/main.ts", source: 'import "./missing"' },
      ],
      testFiles: [],
      entrypoints: ["src/not-present.ts"],
      exemptions: {
        "src/stale.ts": "stale exemption",
      },
    })

    expect(result.missingEntrypoints).toEqual(["src/not-present.ts"])
    expect(result.staleExemptions).toEqual(["src/stale.ts"])
    expect(result.unresolvedInternalEdges).toEqual([
      { consumer: "src/main.ts", specifier: "./missing" },
    ])
  })
})
