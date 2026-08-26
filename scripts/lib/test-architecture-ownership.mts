import type { TestArchitectureBaseline } from "./test-architecture-policy.mts"
import type { PersistenceHeuristicSignal } from "./test-architecture-policy.mts"

export type SemanticInteractionOwner = "02a" | "02b" | "03"

const PERSISTENCE_INTERACTION_OWNERS = new Set([
  "server/actual/actual-metadata-projection.test.ts",
])

export interface TestArchitectureSemanticInventory {
  schemaVersion: 1
  mode: "report-only" | "enforced"
  interactionObservations: Record<string, {
    owner: SemanticInteractionOwner
    observations: number
  }>
  persistenceCandidates: Record<string, {
    owner: "03"
    classification: "candidate" | "retained-contract"
    signals: PersistenceHeuristicSignal[]
    reason?: string
  }>
}

export function semanticInteractionOwners(file: string): SemanticInteractionOwner[] {
  if (PERSISTENCE_INTERACTION_OWNERS.has(file)) return ["03"]
  if (file.startsWith("src/")) return ["02a"]
  if (file.startsWith("server/")) return ["02b"]
  return []
}

export function checkTestArchitectureSemanticInventory({
  inventory,
  interactionObservations,
  persistenceCandidates,
  ownersForInteraction = semanticInteractionOwners,
}: {
  inventory: TestArchitectureSemanticInventory
  interactionObservations: Record<string, number>
  persistenceCandidates: Record<string, PersistenceHeuristicSignal[]>
  ownersForInteraction?: (file: string) => SemanticInteractionOwner[]
}): string[] {
  const failures: string[] = []
  if (inventory.schemaVersion !== 1) failures.push("test-architecture semantic inventory schemaVersion must be 1")
  if (inventory.mode !== "report-only" && inventory.mode !== "enforced") {
    failures.push("test-architecture semantic inventory mode must be report-only or enforced")
  }

  const interactionFiles = new Set([
    ...Object.keys(interactionObservations),
    ...Object.keys(inventory.interactionObservations),
  ])
  for (const file of [...interactionFiles].sort()) {
    const current = interactionObservations[file]
    const recorded = inventory.interactionObservations[file]
    if (current === undefined) {
      failures.push(`${file} is stale in the semantic interaction inventory`)
      continue
    }
    if (recorded === undefined) {
      failures.push(`${file} has ${current} unowned semantic interaction observation(s)`)
      continue
    }
    const owners = ownersForInteraction(file)
    if (owners.length === 0) {
      failures.push(`${file} has no semantic interaction remediation owner`)
    } else if (owners.length > 1) {
      failures.push(`${file} has multiple semantic interaction remediation owners: ${owners.join(", ")}`)
    } else if (recorded.owner !== owners[0]) {
      failures.push(`${file} is assigned to ${recorded.owner}, expected ${owners[0]}`)
    }
    if (recorded.observations !== current) {
      failures.push(`${file} records ${recorded.observations} semantic interaction observation(s), current source has ${current}`)
    }
  }

  const persistenceFiles = new Set([
    ...Object.keys(persistenceCandidates),
    ...Object.keys(inventory.persistenceCandidates),
  ])
  for (const file of [...persistenceFiles].sort()) {
    const current = persistenceCandidates[file]
    const recorded = inventory.persistenceCandidates[file]
    if (current === undefined) {
      failures.push(`${file} is stale in the persistence candidate inventory`)
      continue
    }
    if (recorded === undefined) {
      failures.push(`${file} is an unowned persistence heuristic candidate`)
      continue
    }
    if (recorded.owner !== "03") {
      failures.push(`${file} persistence disposition must be owned by child 03`)
    }
    if (recorded.classification === "retained-contract" && !recorded.reason?.trim()) {
      failures.push(`${file} ${recorded.classification} persistence disposition requires a reason`)
    }
    if (JSON.stringify(recorded.signals) !== JSON.stringify(current)) {
      failures.push(`${file} persistence signals are stale: recorded ${recorded.signals.join(", ")}; current ${current.join(", ")}`)
    }
  }

  if (inventory.mode === "enforced") {
    const candidates = Object.entries(inventory.persistenceCandidates)
      .filter(([, entry]) => entry.classification === "candidate")
      .map(([file]) => file)
    if (candidates.length > 0) {
      failures.push(`enforced semantic inventory has unresolved persistence candidates: ${candidates.join(", ")}`)
    }
  }

  return failures
}

export const TEST_ARCHITECTURE_CHILD_IDS = [
  "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14",
] as const

export type TestArchitectureChildId = typeof TEST_ARCHITECTURE_CHILD_IDS[number]

export interface TestArchitectureOwnershipSummary {
  files: number
  localModuleMockFiles: number
  localModuleMockEdges: number
  interactionAssertionFiles: number
  interactionAssertions: number
}

const CHILD_10_EXACT_PATHS = new Set([
  "src/App.test.tsx",
  "src/api.onboarding.demo.test.ts",
  "src/setupApi.test.ts",
])

function isChild06(file: string): boolean {
  return file.startsWith("src/components/calendar/events/")
    || /^src\/components\/calendar\/(?:CalendarEventEditor(?:\..+)?|CalendarDeadlineQuickActions|useCalendarGhostPreview)\.test\.tsx$/.test(file)
    || [
      "src/components/calendar/CalendarModal.agenda-scroll.test.tsx",
      "src/components/calendar/CalendarModal.events.test.tsx",
    ].includes(file)
}

function isChild10(file: string): boolean {
  return CHILD_10_EXACT_PATHS.has(file)
    || file.startsWith("src/auth/")
    || /^src\/pages\/(?:Login|Onboarding|OwnerSetup|Settings)(?:\..+)?\.test\.tsx$/.test(file)
    || file.startsWith("src/hooks/settings/")
}

const OWNERSHIP_RULES: ReadonlyArray<{
  child: TestArchitectureChildId
  matches: (file: string) => boolean
}> = [
  {
    child: "02",
    matches: (file) => /^server\/[^/]+\.test\.ts$/.test(file)
      || /^server\/(?:routes|middleware|auth|db)\//.test(file),
  },
  { child: "03", matches: (file) => /^server\/(?:actual|bills|platform|transactions)\//.test(file) },
  { child: "04", matches: (file) => /^server\/(?:calendar|dashboard|reminders|snapshots|tasks)\//.test(file) },
  { child: "05", matches: (file) => /^server\/(?:email|triage|transaction-imports|alfred|news)\//.test(file) },
  { child: "06", matches: isChild06 },
  { child: "07", matches: (file) => file.startsWith("src/components/calendar/") && !isChild06(file) },
  { child: "08", matches: (file) => file.startsWith("src/hooks/calendar/") },
  { child: "09", matches: (file) => file.startsWith("src/components/settings/") },
  { child: "10", matches: isChild10 },
  { child: "11", matches: (file) => /^src\/components\/(?:inbox|todoist)\//.test(file) },
  {
    child: "12",
    matches: (file) => /^src\/components\/(?:dashboard|bills)\//.test(file)
      || file.startsWith("src/context/")
      || /^src\/pages\/Dashboard(?:\..+)?\.test\.tsx$/.test(file),
  },
  { child: "13", matches: (file) => /^src\/components\/(?:alfred|briefing|layout|news|notes|shell)\//.test(file) },
  {
    child: "14",
    matches: (file) => /^src\/components\/(?:shared|ui)\//.test(file)
      || (file.startsWith("src/hooks/") && !file.startsWith("src/hooks/calendar/") && !file.startsWith("src/hooks/settings/"))
      || /^src\/(?:lib|demo)\//.test(file)
      || (/^src\/api(?:\..+)?\.test\.ts$/.test(file) && !isChild10(file)),
  },
]

export function testArchitectureOwners(file: string): TestArchitectureChildId[] {
  return OWNERSHIP_RULES.filter((rule) => rule.matches(file)).map((rule) => rule.child)
}

function emptySummary(): TestArchitectureOwnershipSummary {
  return {
    files: 0,
    localModuleMockFiles: 0,
    localModuleMockEdges: 0,
    interactionAssertionFiles: 0,
    interactionAssertions: 0,
  }
}

export function checkTestArchitectureOwnership(
  baseline: TestArchitectureBaseline,
  ownersForFile: (file: string) => TestArchitectureChildId[] = testArchitectureOwners,
): {
  failures: string[]
  summaries: Record<TestArchitectureChildId, TestArchitectureOwnershipSummary>
} {
  const failures: string[] = []
  const summaries = Object.fromEntries(
    TEST_ARCHITECTURE_CHILD_IDS.map((child) => [child, emptySummary()]),
  ) as Record<TestArchitectureChildId, TestArchitectureOwnershipSummary>
  const files = new Set([
    ...Object.keys(baseline.localModuleMocks),
    ...Object.keys(baseline.interactionAssertions),
  ])

  for (const file of [...files].sort()) {
    const owners = ownersForFile(file)
    if (owners.length === 0) {
      failures.push(`${file} has no test-architecture elimination child owner`)
      continue
    }
    if (owners.length > 1) {
      failures.push(`${file} has multiple test-architecture elimination child owners: ${owners.join(", ")}`)
      continue
    }

    const owner = owners[0]
    if (owner === undefined) continue
    const summary = summaries[owner]
    const mockTargets = baseline.localModuleMocks[file]
    const interactionCount = baseline.interactionAssertions[file]
    summary.files += 1
    if (mockTargets !== undefined) {
      summary.localModuleMockFiles += 1
      summary.localModuleMockEdges += Object.values(mockTargets).reduce((total, count) => total + count, 0)
    }
    if (interactionCount !== undefined) {
      summary.interactionAssertionFiles += 1
      summary.interactionAssertions += interactionCount
    }
  }

  return { failures, summaries }
}
