import { describe, expect, it } from "vitest"
import {
  checkTestArchitectureApprovalsEmpty,
  checkTestArchitectureBaseline,
  checkTestArchitectureBaselineEmpty,
  checkTestArchitectureBaselineGrowth,
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
      exemptionViolations: [
        "line 1 has a test-architecture exemption that is not beside its exact construct",
        "line 4 applies one test-architecture exemption to 2 constructs",
      ],
    })
  })
})

describe("checkTestArchitectureBaseline", () => {
  it("rejects new debt and warns when existing debt falls", () => {
    const result = checkTestArchitectureBaseline({
      files: {
        "src/new.test.ts": { localModuleMocks: { "../new.ts": 1 }, interactionAssertions: 0 },
        "src/legacy.test.ts": { localModuleMocks: { "../old.ts": 1 }, interactionAssertions: 2 },
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
        "src/legacy.test.ts": { localModuleMocks: { "../replacement.ts": 1 }, interactionAssertions: 0 },
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
