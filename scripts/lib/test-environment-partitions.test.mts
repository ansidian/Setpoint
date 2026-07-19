import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  collectVitestTestFiles,
  getTestEnvironmentAssignments,
  slowIntegrationTests,
  type TestEnvironmentPartition,
} from "./test-environment-partitions.mts"

const root = path.resolve(import.meta.dirname, "../..")

describe("Vitest environment partitions", () => {
  test("assign every test file to exactly one environment", async () => {
    const testFiles = await collectVitestTestFiles(root)
    const assignments = testFiles.map((file) => ({
      file,
      environments: getTestEnvironmentAssignments(file),
    }))

    expect(assignments.filter(({ environments }) => environments.length === 0)).toEqual([])
    expect(assignments.filter(({ environments }) => environments.length > 1)).toEqual([])
  })

  test("keep server and script tests in Node-based projects", async () => {
    const testFiles = await collectVitestTestFiles(root)
    const serverAndScriptTests = testFiles.filter(
      (file) => file.startsWith("server/") || file.startsWith("scripts/"),
    )

    expect(serverAndScriptTests).not.toHaveLength(0)
    expect(
      serverAndScriptTests.filter(
        (file) => !["node", "slow-integration"].includes(getTestEnvironmentAssignments(file)[0]!),
      ),
    ).toEqual([])
  })

  test("reports synthetic missing and overlapping project ownership", () => {
    const partitions: TestEnvironmentPartition[] = [
      {
        name: "node",
        environment: "node",
        include: ["src/**/*.test.ts"],
      },
      {
        name: "happy-dom",
        environment: "happy-dom",
        include: ["src/overlap/**/*.test.ts"],
      },
    ]

    expect(getTestEnvironmentAssignments("src/missing/example.test.tsx", partitions)).toEqual([])
    expect(getTestEnvironmentAssignments("src/overlap/example.test.ts", partitions)).toEqual([
      "node",
      "happy-dom",
    ])
  })

  test("assign every classified filesystem integration to the slow project once", () => {
    expect(slowIntegrationTests).toEqual([...slowIntegrationTests].sort())
    expect(slowIntegrationTests).not.toHaveLength(0)
    expect(
      slowIntegrationTests.map((file) => ({
        file,
        projects: getTestEnvironmentAssignments(file),
      })),
    ).toEqual(
      slowIntegrationTests.map((file) => ({ file, projects: ["slow-integration"] })),
    )
  })

  test("keep fast, slow, and complete commands aligned with the project partition", async () => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts.test).not.toContain("--project")
    expect(packageJson.scripts["test:fast"]).toContain("--project node")
    expect(packageJson.scripts["test:fast"]).toContain("--project happy-dom")
    expect(packageJson.scripts["test:fast"]).toContain("--project jsdom")
    expect(packageJson.scripts["test:fast"]).not.toContain("slow-integration")
    expect(packageJson.scripts["test:slow"]).toContain("--project slow-integration")
  })
})
