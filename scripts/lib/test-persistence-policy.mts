import type { PersistenceHeuristicSignal } from "./test-architecture-policy.mts"

export interface TestPersistenceContract {
  signals: PersistenceHeuristicSignal[]
  reason: string
}

export function checkTestPersistenceContracts({
  contracts,
  candidates,
}: {
  contracts: Record<string, TestPersistenceContract>
  candidates: Record<string, PersistenceHeuristicSignal[]>
}): string[] {
  const failures: string[] = []
  const files = new Set([...Object.keys(candidates), ...Object.keys(contracts)])

  for (const file of [...files].sort()) {
    const current = candidates[file]
    const recorded = contracts[file]
    if (current === undefined) {
      failures.push(`${file} is stale in the persistence contract inventory`)
    } else if (recorded === undefined) {
      failures.push(`${file} has unreviewed persistence contract assertions`)
    } else {
      if (!recorded.reason?.trim()) {
        failures.push(`${file} persistence contract requires a reason`)
      }
      if (JSON.stringify(recorded.signals) !== JSON.stringify(current)) {
        failures.push(`${file} persistence signals are stale: recorded ${recorded.signals.join(", ")}; current ${current.join(", ")}`)
      }
    }
  }

  return failures
}
