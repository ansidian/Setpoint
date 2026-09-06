import { describe, expect, it } from "vitest"
import {
  checkTestArchitectureMetrics,
  checkTestArchitectureBaselineEmpty,
  checkTestArchitectureMockMetadataObservations,
  collectPersistenceHeuristicSignals,
  collectTestArchitectureMetrics,
  hasPersistenceContractSignals,
  normalizeTestArchitecturePath,
} from "./test-architecture-policy.mts"

describe("collectTestArchitectureMetrics", () => {
  it("counts project-local mocks and interaction assertions but ignores packages", () => {
    const source = [
      'vi.mock("../internal.ts", () => ({}))',
      'vi.mock("@/hooks/useThing", () => ({}))',
      'vi.mock(\n  "../multiline.ts",\n  () => ({})\n)',
      'vi.mock("node:fs", () => ({}))',
      'vi.mock("react", () => ({}))',
      'expect(save).toHaveBeenCalledWith("x")',
      'expect(load).not.toHaveBeenCalledTimes(2)',
    ].join("\n")
    expect(collectTestArchitectureMetrics(source)).toEqual({
      localModuleMocks: {
        "../internal.ts": 1,
        "@/hooks/useThing": 1,
        "../multiline.ts": 1,
      },
      interactionAssertions: 2,
      interactionAssertionLines: [9, 10],
      mockMetadataObservations: 0,
      exemptionViolations: [],
    })
  })

  it("accepts only reasoned boundary exemptions", () => {
    const source = [
      '// test-architecture: allow-boundary-mock -- provider adapter is the module boundary',
      'vi.mock("../provider.ts", () => ({}))',
      '// test-architecture: allow-boundary-interaction -- outbound provider payload is the contract',
      'expect(send).toHaveBeenCalledWith({ ok: true })',
      '// test-architecture: allow-boundary-mock --',
      'vi.mock("../unreasoned.ts", () => ({}))',
    ].join("\n")
    expect(collectTestArchitectureMetrics(source)).toEqual({
      localModuleMocks: { "../unreasoned.ts": 1 },
      interactionAssertions: 0,
      mockMetadataObservations: 0,
      exemptionViolations: ["line 5 has an empty test-architecture boundary rationale"],
    })
  })

  it("rejects exemptions that are not local to exactly one construct", () => {
    const source = [
      '// test-architecture: allow-boundary-mock -- external provider response is controlled here',
      'const unrelated = true',
      'vi.mock("../provider.ts", () => ({}))',
      '// test-architecture: allow-boundary-interaction -- outbound provider writes share a blanket marker',
      'expect(save).toHaveBeenCalled(); expect(load).toHaveBeenCalled()',
    ].join("\n")
    expect(collectTestArchitectureMetrics(source)).toEqual({
      localModuleMocks: { "../provider.ts": 1 },
      interactionAssertions: 0,
      mockMetadataObservations: 0,
      exemptionViolations: [
        "line 1 has a test-architecture exemption that is not beside its exact construct",
        "line 4 applies one test-architecture exemption to 2 constructs",
      ],
    })
  })

  it("reports direct and extracted mock metadata independently of matcher syntax", () => {
    const source = [
      "expect(send.mock.calls).toHaveLength(1)",
      "expect(send.mock.lastCall).toEqual([{ ok: true }])",
      "expect(send.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0])",
      "expect(send.mock.results[0]?.value).toBe(true)",
      "expect(send.mock.settledResults?.[0]?.value).toBe(true)",
      "expect(send.mock.instances[0]).toBeDefined()",
      "expect(send.mock.contexts[0]).toBeDefined()",
      "const extracted = send.mock.calls",
      "expect(extracted).toHaveLength(1)",
    ].join("\n")

    expect(collectTestArchitectureMetrics(source)).toMatchObject({
      interactionAssertions: 0,
      mockMetadataObservations: 9,
      exemptionViolations: [],
    })
  })

  it("reports optional, indexed, vi.mocked, destructured, and statically aliased metadata", () => {
    const source = [
      "expect(send.mock?.calls).toHaveLength(1)",
      'expect(send["mock"]["calls"]).toHaveLength(1)',
      "expect(vi.mocked(send).mock.calls).toHaveLength(1)",
      "const { calls: extractedCalls, results } = send.mock",
      "const state = vi.mocked(send).mock",
      "const aliasedState = state",
      "expect(aliasedState.lastCall).toEqual([])",
      "let assigned",
      "assigned = send.mock",
      "expect(assigned.contexts).toEqual([])",
    ].join("\n")

    expect(collectTestArchitectureMetrics(source)).toMatchObject({
      mockMetadataObservations: 7,
      exemptionViolations: [],
    })
  })

  it("applies interaction exemptions to the exact metadata observation", () => {
    const source = [
      "// test-architecture: allow-boundary-interaction -- outbound provider payload is the contract",
      "const calls = send.mock.calls",
      "// test-architecture: allow-boundary-interaction -- browser constructor state is observable only on the fake",
      "expect(Audio.mock.instances[0]).toBeDefined()",
    ].join("\n")

    expect(collectTestArchitectureMetrics(source)).toMatchObject({
      mockMetadataObservations: 0,
      exemptionViolations: [],
    })
  })

  it("rejects the dashboard syntax substitution that escaped matcher enforcement", () => {
    expect(collectTestArchitectureMetrics(
      "expect(getCurrentDashboard.mock.calls).toHaveLength(2)",
    )).toMatchObject({
      interactionAssertions: 0,
      mockMetadataObservations: 1,
    })
  })
})

describe("checkTestArchitectureMetrics", () => {
  it("reports interaction assertions for review without blocking CI", () => {
    const result = checkTestArchitectureMetrics({
      "src/component.test.tsx": {
        localModuleMocks: {},
        interactionAssertions: 2,
        interactionAssertionLines: [14, 27],
        mockMetadataObservations: 0,
      },
    })

    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([
      "src/component.test.tsx has 2 reviewable interaction assertion(s) at lines 14, 27; prefer observable results, or add an exact test-architecture boundary rationale when the interaction is the unavoidable contract",
    ])
  })

  it("rejects internal mocks and invalid boundary exemptions", () => {
    const result = checkTestArchitectureMetrics({
      "src/feature.test.ts": collectTestArchitectureMetrics([
        '// test-architecture: allow-boundary-mock --',
        'vi.mock("./internal.ts", () => ({}))',
      ].join("\n")),
    })
    expect(result.failures).toEqual([
      "src/feature.test.ts: line 1 has an empty test-architecture boundary rationale",
      "src/feature.test.ts mocks local module ./internal.ts 1 time(s); mock external boundaries instead",
    ])
  })

  it("normalizes Windows paths", () => {
    expect(normalizeTestArchitecturePath("src\\hooks\\thing.test.ts")).toBe("src/hooks/thing.test.ts")
  })
})

describe("checkTestArchitectureMockMetadataObservations", () => {
  it("enforces zero unreviewed metadata observations without a baseline", () => {
    expect(checkTestArchitectureMockMetadataObservations({
      "src/escaped.test.ts": {
        localModuleMocks: {},
        interactionAssertions: 0,
        mockMetadataObservations: 2,
      },
      "src/reviewed.test.ts": {
        localModuleMocks: {},
        interactionAssertions: 0,
        mockMetadataObservations: 0,
      },
    })).toEqual([
      "src/escaped.test.ts has 2 unreviewed mock-metadata observation(s); remove them or add exact construct-local boundary rationales",
    ])
  })
})

describe("collectPersistenceHeuristicSignals", () => {
  it("separates broad fake-database hints from enforceable persistence contracts", () => {
    expect(hasPersistenceContractSignals(["manual-execute-fake", "named-fake-database"]))
      .toBe(false)
    expect(hasPersistenceContractSignals(["manual-execute-fake", "sql-shape-assertion"]))
      .toBe(true)
    expect(hasPersistenceContractSignals(["mock-execute-observation"]))
      .toBe(true)
  })

  it("reports hand-written database substitutes and SQL-shape observations", () => {
    const source = [
      "const mockDb = { execute: async (query) => ({ rows: [] }) }",
      "const statement = mockDb.execute.mock.calls[0]?.[0]",
      "expect(statement.sql).toMatch(/INSERT/)",
      "expect(statement.args).toEqual([\"user-1\"])",
    ].join("\n")

    expect(collectPersistenceHeuristicSignals(source)).toEqual([
      "manual-execute-fake",
      "mock-execute-observation",
      "named-fake-database",
      "positional-db-args-assertion",
      "sql-shape-assertion",
    ])
  })

  it("does not mistake ordinary operation or process arguments for database shape", () => {
    expect(collectPersistenceHeuristicSignals([
      "const args = buildFfmpegArgs()",
      "expect(args).toContain(\"-af\")",
      "expect(operations.creates).toEqual([])",
    ].join("\n"))).toEqual([])
  })
})

describe("checkTestArchitectureBaselineEmpty", () => {
  it("permanently rejects aggregate baseline entries", () => {
    expect(checkTestArchitectureBaselineEmpty({
      localModuleMocks: { "src/legacy.test.ts": { "../provider.ts": 1 } },
      interactionAssertions: {},
    })).toEqual([
      "test-architecture baseline must remain empty; aggregate grandfathered allowances are forbidden",
    ])
    expect(checkTestArchitectureBaselineEmpty({
      localModuleMocks: {},
      interactionAssertions: {},
    })).toEqual([])
  })
})
