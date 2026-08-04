import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { TestArchitectureBaseline } from "./test-architecture-policy.mts"
import {
  checkTestArchitectureOwnership,
  testArchitectureOwners,
} from "./test-architecture-ownership.mts"

describe("test-architecture elimination ownership", () => {
  it("classifies every current baseline key exactly once", () => {
    const baseline = JSON.parse(
      readFileSync("scripts/lib/test-architecture-baseline.json", "utf8"),
    ) as TestArchitectureBaseline
    const result = checkTestArchitectureOwnership(baseline)
    const totals = Object.values(result.summaries).reduce((sum, child) => ({
      files: sum.files + child.files,
      localModuleMockEdges: sum.localModuleMockEdges + child.localModuleMockEdges,
      interactionAssertions: sum.interactionAssertions + child.interactionAssertions,
    }), { files: 0, localModuleMockEdges: 0, interactionAssertions: 0 })
    const baselineFiles = new Set([
      ...Object.keys(baseline.localModuleMocks),
      ...Object.keys(baseline.interactionAssertions),
    ])

    expect(result.failures).toEqual([])
    expect(totals).toEqual({
      files: baselineFiles.size,
      localModuleMockEdges: Object.values(baseline.localModuleMocks)
        .flatMap((targets) => Object.values(targets))
        .reduce((sum, count) => sum + count, 0),
      interactionAssertions: Object.values(baseline.interactionAssertions)
        .reduce((sum, count) => sum + count, 0),
    })
  })

  it("keeps overlapping Calendar and API scopes in their selected children", () => {
    expect(testArchitectureOwners("src/components/calendar/CalendarModal.events.test.tsx")).toEqual(["06"])
    expect(testArchitectureOwners("src/components/calendar/modal/CalendarGrid.motion.test.tsx")).toEqual(["07"])
    expect(testArchitectureOwners("src/api.onboarding.demo.test.ts")).toEqual(["10"])
    expect(testArchitectureOwners("src/api.emailBody.test.ts")).toEqual(["14"])
  })

  it("reports baseline files outside the frozen campaign partition", () => {
    const result = checkTestArchitectureOwnership({
      localModuleMocks: { "new-area/unowned.test.ts": { "./internal.ts": 1 } },
      interactionAssertions: {},
    })
    expect(result.failures).toEqual([
      "new-area/unowned.test.ts has no test-architecture elimination child owner",
    ])
  })

  it("rejects multiply owned baseline files", () => {
    const baseline = {
      localModuleMocks: { "src/overlap.test.ts": { "./internal.ts": 1 } },
      interactionAssertions: {},
    }
    const result = checkTestArchitectureOwnership(baseline, () => ["02", "03"])
    expect(result.failures).toEqual([
      "src/overlap.test.ts has multiple test-architecture elimination child owners: 02, 03",
    ])
  })
})
