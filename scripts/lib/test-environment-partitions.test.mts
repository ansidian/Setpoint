import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  collectVitestTestFiles,
  getTestEnvironmentAssignments,
  testEnvironmentPartitions,
} from "./test-environment-partitions.mts"

const root = path.resolve(import.meta.dirname, "../..")

describe("Vitest environment partitions", () => {
  test("assigns every existing test once and rejects stale explicit paths", async () => {
    const testFiles = await collectVitestTestFiles(root)
    const assignments = testFiles.map((file) => ({
      file,
      projects: getTestEnvironmentAssignments(file),
    }))
    expect(testFiles.length).toBeGreaterThan(0)
    expect(assignments.filter(({ projects }) => projects.length !== 1)).toEqual([])
    expect(assignments.filter(({ file, projects }) =>
      (file.startsWith("server/") || file.startsWith("scripts/"))
      && !["node", "slow-integration"].includes(projects[0]!),
    )).toEqual([])

    const explicitPaths = new Set(testEnvironmentPartitions.flatMap(({ include, exclude }) =>
      [...include, ...exclude ?? []].filter((pattern) => !pattern.includes("*")),
    ))
    const existing = new Set(testFiles)
    expect([...explicitPaths].filter((file) => !existing.has(file))).toEqual([])
  })
})
