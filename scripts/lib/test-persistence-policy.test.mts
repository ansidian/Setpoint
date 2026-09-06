import { describe, expect, it } from "vitest"
import { checkTestPersistenceContracts, type TestPersistenceContract } from "./test-persistence-policy.mts"

describe("reviewed persistence contracts", () => {
  const contract: TestPersistenceContract = {
    signals: ["sql-shape-assertion"],
    reason: "Provider-owned storage has a versioned SQL wire contract.",
  }

  it("accepts exact reviewed contracts", () => {
    expect(checkTestPersistenceContracts({
      contracts: { "server/provider.test.ts": contract },
      candidates: { "server/provider.test.ts": ["sql-shape-assertion"] },
    })).toEqual([])
  })

  it("rejects new assertions and deleted contracts left in the inventory", () => {
    expect(checkTestPersistenceContracts({
      contracts: { "server/old.test.ts": contract },
      candidates: { "server/new.test.ts": ["mock-execute-observation"] },
    })).toEqual([
      "server/new.test.ts has unreviewed persistence contract assertions",
      "server/old.test.ts is stale in the persistence contract inventory",
    ])
  })

  it("rejects unreasoned contracts and changed assertion types", () => {
    expect(checkTestPersistenceContracts({
      contracts: { "server/provider.test.ts": { ...contract, reason: " " } },
      candidates: { "server/provider.test.ts": ["positional-db-args-assertion"] },
    })).toEqual([
      "server/provider.test.ts persistence contract requires a reason",
      "server/provider.test.ts persistence signals are stale: recorded sql-shape-assertion; current positional-db-args-assertion",
    ])
  })
})
