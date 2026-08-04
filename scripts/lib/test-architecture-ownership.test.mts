import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { TestArchitectureBaseline } from "./test-architecture-policy.mts"
import {
  checkTestArchitectureSemanticInventory,
  checkTestArchitectureOwnership,
  semanticInteractionOwners,
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

describe("third-pass semantic ownership", () => {
  const inventory = {
    schemaVersion: 1 as const,
    mode: "report-only" as const,
    interactionObservations: {
      "src/feature.test.ts": { owner: "02a" as const, observations: 2 },
      "server/provider.test.ts": { owner: "02b" as const, observations: 1 },
    },
    persistenceCandidates: {
      "server/store.test.ts": {
        owner: "03" as const,
        classification: "candidate" as const,
        signals: ["manual-execute-fake" as const],
      },
    },
  }

  it("accepts exact report-only ownership", () => {
    expect(checkTestArchitectureSemanticInventory({
      inventory,
      interactionObservations: {
        "src/feature.test.ts": 2,
        "server/provider.test.ts": 1,
      },
      persistenceCandidates: {
        "server/store.test.ts": ["manual-execute-fake"],
      },
    })).toEqual([])
  })

  it("routes the invalid Actual metadata fake to persistence remediation", () => {
    expect(semanticInteractionOwners("server/actual/actual-metadata-projection.test.ts")).toEqual(["03"])
    expect(semanticInteractionOwners("server/actual/actual-worker.test.ts")).toEqual(["02b"])
  })

  it("rejects unowned, multiply owned, stale, and count-laundered entries", () => {
    expect(checkTestArchitectureSemanticInventory({
      inventory,
      interactionObservations: {
        "src/feature.test.ts": 1,
        "server/new.test.ts": 1,
      },
      persistenceCandidates: {},
      ownersForInteraction: (file) => file === "src/feature.test.ts" ? ["02a", "02b"] : semanticInteractionOwners(file),
    })).toEqual([
      "server/new.test.ts has 1 unowned semantic interaction observation(s)",
      "server/provider.test.ts is stale in the semantic interaction inventory",
      "src/feature.test.ts has multiple semantic interaction remediation owners: 02a, 02b",
      "src/feature.test.ts records 2 semantic interaction observation(s), current source has 1",
      "server/store.test.ts is stale in the persistence candidate inventory",
    ])
  })

  it("requires reasons and zero unresolved persistence candidates at enforcement", () => {
    expect(checkTestArchitectureSemanticInventory({
      inventory: {
        ...inventory,
        mode: "enforced",
        persistenceCandidates: {
          "server/store.test.ts": {
            owner: "03",
            classification: "candidate",
            signals: ["manual-execute-fake"],
          },
          "server/contract.test.ts": {
            owner: "03",
            classification: "retained-contract",
            signals: ["sql-shape-assertion"],
          },
        },
      },
      interactionObservations: {
        "src/feature.test.ts": 2,
        "server/provider.test.ts": 1,
      },
      persistenceCandidates: {
        "server/store.test.ts": ["manual-execute-fake"],
        "server/contract.test.ts": ["sql-shape-assertion"],
      },
    })).toEqual([
      "server/contract.test.ts retained-contract persistence disposition requires a reason",
      "enforced semantic inventory has unresolved persistence candidates: server/store.test.ts",
    ])
  })
})
