import type { TestArchitectureBaseline } from "./test-architecture-policy.mts"

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
