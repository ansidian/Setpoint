import { describe, expect, it } from "vitest"
import {
  checkTestArchitectureApprovalsEmpty,
  checkTestArchitectureBaseline,
  checkTestArchitectureBaselineEmpty,
  checkTestArchitectureBaselineGrowth,
  checkTestArchitectureMockMetadataObservations,
  collectPersistenceHeuristicSignals,
  collectTestArchitectureMetrics,
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

describe("checkTestArchitectureBaseline", () => {
  it("rejects new debt and warns when existing debt falls", () => {
    const result = checkTestArchitectureBaseline({
      files: {
        "src/new.test.ts": { localModuleMocks: { "../new.ts": 1 }, interactionAssertions: 0, mockMetadataObservations: 0 },
        "src/legacy.test.ts": { localModuleMocks: { "../old.ts": 1 }, interactionAssertions: 2, mockMetadataObservations: 0 },
      },
      baseline: {
        localModuleMocks: { "src/legacy.test.ts": { "../old.ts": 2 } },
        interactionAssertions: { "src/legacy.test.ts": 3 },
      },
    })
    expect(result.failures).toEqual([
      "src/new.test.ts mocks ../new.ts 1 time(s), above the test-architecture baseline allowance 0",
    ])
    expect(result.warnings).toEqual(expect.arrayContaining([
      "src/legacy.test.ts reduced mocks of ../old.ts from 2 to 1; ratchet the test-architecture baseline down",
      "src/legacy.test.ts reduced interactionAssertions from 3 to 2; ratchet the test-architecture baseline down",
    ]))
  })

  it("rejects swapping an allowed local mock for a new internal edge", () => {
    const result = checkTestArchitectureBaseline({
      files: {
        "src/legacy.test.ts": { localModuleMocks: { "../replacement.ts": 1 }, interactionAssertions: 0, mockMetadataObservations: 0 },
      },
      baseline: {
        localModuleMocks: { "src/legacy.test.ts": { "../old.ts": 1 } },
        interactionAssertions: {},
      },
    })
    expect(result.failures).toEqual([
      "src/legacy.test.ts mocks ../replacement.ts 1 time(s), above the test-architecture baseline allowance 0",
    ])
    expect(result.warnings).toContain(
      "src/legacy.test.ts reduced mocks of ../old.ts from 1 to 0; ratchet the test-architecture baseline down",
    )
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

describe("checkTestArchitectureBaselineGrowth", () => {
  const previousBaseline = {
    localModuleMocks: { "src/legacy.test.ts": { "../provider.ts": 1 } },
    interactionAssertions: { "src/legacy.test.ts": 2 },
  }

  it("rejects raised allowances without an exact owner approval", () => {
    expect(checkTestArchitectureBaselineGrowth({
      previousBaseline,
      baseline: {
        localModuleMocks: { "src/legacy.test.ts": { "../provider.ts": 2 } },
        interactionAssertions: { "src/legacy.test.ts": 3 },
      },
    })).toEqual([
      "src/legacy.test.ts raises the interactionAssertions baseline from 2 to 3; the debt-elimination campaign is shrink-only",
      "src/legacy.test.ts raises the local mock baseline for ../provider.ts from 1 to 2; the debt-elimination campaign is shrink-only",
    ])
  })

  it("does not let a former exact approval authorize growth", () => {
    const approval = {
      from: 1,
      to: 2,
      approvedBy: "repository owner",
      reason: "provider adapter became the reviewed module boundary",
    }
    expect(checkTestArchitectureApprovalsEmpty({
      localModuleMocks: { "src/legacy.test.ts": { "../provider.ts": approval } },
      interactionAssertions: {},
    })).toEqual([
      "test-architecture baseline approvals must remain empty; use construct-local boundary rationales",
    ])
    expect(checkTestArchitectureBaselineGrowth({
      previousBaseline,
      baseline: {
        localModuleMocks: { "src/legacy.test.ts": { "../provider.ts": 2 } },
        interactionAssertions: { "src/legacy.test.ts": 2 },
      },
    })).toEqual([
      "src/legacy.test.ts raises the local mock baseline for ../provider.ts from 1 to 2; the debt-elimination campaign is shrink-only",
    ])
  })

  it("accepts an empty frozen approval ledger", () => {
    expect(checkTestArchitectureApprovalsEmpty({
      localModuleMocks: {},
      interactionAssertions: {},
    })).toEqual([])
  })

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
