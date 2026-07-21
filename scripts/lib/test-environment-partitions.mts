import fs from "node:fs/promises"
import path from "node:path"

export type TestEnvironmentName = "node" | "happy-dom" | "jsdom"
export type TestProjectName = TestEnvironmentName | "slow-integration"

export interface TestEnvironmentPartition {
  name: TestProjectName
  environment: TestEnvironmentName
  include: string[]
  exclude?: string[]
}

const jsdomTests = [
  "src/components/email/EmailIframe.test.tsx",
  "src/components/inbox/reader/ActualActionStatus.test.tsx",
  "src/components/inbox/reader/DesktopReader.test.tsx",
  "src/components/inbox/reader/MobileReader.mobile-sheet.test.tsx",
  "src/components/inbox/reader/MobileReader.test.tsx",
  "src/components/inbox/reader/MobileTriageBar.test.tsx",
  "src/components/inbox/reader/Reader.remind.test.tsx",
]

// `.test.ts` defaults to Node. Keep the smaller set that exercises hooks or
// browser APIs explicit so adding a pure model/helper test never pays for DOM.
const happyDomTypescriptTests = [
  "src/components/calendar/events/quickActionMenuLayout.test.ts",
  "src/components/calendar/events/useCalendarEventTitleComposer.test.ts",
  "src/components/calendar/events/useCalendarQuickActions.test.ts",
  "src/components/calendar/events/useCalendarQuickActions.cloneRaces.test.ts",
  "src/components/calendar/events/useCalendarQuickActions.pasteRaces.test.ts",
  "src/components/calendar/events/useCalendarQuickActions.selectionIdentity.test.ts",
  "src/components/calendar/modal/CalendarCellOverflowPopover.position.test.ts",
  "src/components/calendar/modal/calendarGridUtils.test.ts",
  "src/components/calendar/views/deadlines/useDeadlineQuickActions.test.ts",
  "src/components/inbox/inboxHotkeys.test.ts",
  "src/components/inbox/reader/useEmailBody.test.ts",
  "src/components/inbox/sidebarCompactStore.test.ts",
  "src/components/inbox/useInboxActionDispatch.test.ts",
  "src/components/inbox/useInboxActionDispatch.pin.test.ts",
  "src/components/inbox/useInboxActionDispatch.read.test.ts",
  "src/components/inbox/useInboxActionDispatch.trashSnooze.test.ts",
  "src/components/inbox/useInboxController.test.ts",
  "src/components/inbox/useInboxSessionState.test.ts",
  "src/components/inbox/useInboxUndoSlot.test.ts",
  "src/components/inbox/useIndexedSearch.test.ts",
  "src/components/ui/bottomSheetModel.test.ts",
  "src/demo/demoMode.test.ts",
  "src/hooks/calendar/calendarFloatingDetailModel.test.ts",
  "src/hooks/calendar/useAgendaFetch.test.ts",
  "src/hooks/calendar/useAgendaSyncPolicy.test.ts",
  "src/hooks/calendar/useCalendarDomainRange.test.ts",
  "src/hooks/calendar/useCalendarDomainRange.seedRace.test.ts",
  "src/hooks/calendar/useEditorCancelOnScroll.test.ts",
  "src/hooks/calendar/useCalendarModalViewModel.test.ts",
  "src/hooks/calendar/useCalendarRange.test.ts",
  "src/hooks/calendar/useCalendarScrollSync.test.ts",
  "src/hooks/calendar/useDashboardFocusRetry.test.ts",
  "src/hooks/calendar/useFloatingEditorRouting.test.ts",
  "src/hooks/calendar/usePlanningReadinessState.test.ts",
  "src/hooks/calendar/useStaleDomainCache.test.ts",
  "src/hooks/calendar/useViewportWidth.test.ts",
  "src/hooks/email/useInboxSelectionHistory.test.ts",
  "src/hooks/useAutoRefresh.test.ts",
  "src/hooks/useBrowserBackDismiss.test.ts",
  "src/hooks/useCurrentDashboard.test.ts",
  "src/hooks/useCurrentDashboard.events.test.ts",
  "src/hooks/useCurrentDashboard.eventRefresh.test.ts",
  "src/hooks/useDismissablePortal.test.ts",
  "src/hooks/useWarmImport.test.ts",
  "src/lib/scrollLock.test.ts",
  "src/lib/triageSoundGate.test.ts",
]

export const slowIntegrationTests = [
  "scripts/check-typescript-migration.test.mts",
  "server/actual/actual-lightweight-writes.test.ts",
  "server/actual/actual-local-metadata.test.ts",
  "server/actual/actual-transactions-read.test.ts",
  "server/actual/actualMetadataCacheStore.test.ts",
  "server/db/migrate.test.ts",
  "server/google-oauth-credentials.test.ts",
  "server/platform/instance-credential-service.test.ts",
  "server/platform/instance-credential-store.test.ts",
  "server/tasks/todoist-oauth-credentials.test.ts",
  "server/test-utils/temp-dir.test.ts",
  "server/triage/triage-eval.test.ts",
  "server/triage/triage-preflight-rules.test.ts",
]

export const testEnvironmentPartitions: TestEnvironmentPartition[] = [
  {
    name: "node",
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "scripts/**/*.test.mts",
      "src/**/*.test.ts",
    ],
    exclude: [...happyDomTypescriptTests, ...slowIntegrationTests],
  },
  {
    name: "happy-dom",
    environment: "happy-dom",
    include: ["src/**/*.test.tsx", ...happyDomTypescriptTests],
    exclude: jsdomTests,
  },
  {
    name: "jsdom",
    environment: "jsdom",
    include: jsdomTests,
  },
  {
    name: "slow-integration",
    environment: "node",
    include: slowIntegrationTests,
  },
]

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/")
}

function matchesAny(filePath: string, patterns: string[] | undefined): boolean {
  return patterns?.some((pattern) => path.matchesGlob(filePath, pattern)) ?? false
}

export function getTestEnvironmentAssignments(
  filePath: string,
  partitions: TestEnvironmentPartition[] = testEnvironmentPartitions,
): TestProjectName[] {
  const normalizedPath = normalizePath(filePath)
  return partitions
    .filter(
      ({ include, exclude }) =>
        matchesAny(normalizedPath, include) && !matchesAny(normalizedPath, exclude),
    )
    .map(({ name }) => name)
}

export async function collectVitestTestFiles(root: string): Promise<string[]> {
  const testFiles: string[] = []

  async function walk(relativeDirectory: string): Promise<void> {
    const absoluteDirectory = path.join(root, relativeDirectory)
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true })

    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) {
        await walk(relativePath)
        continue
      }

      if (/\.test\.(?:ts|tsx|mts)$/.test(entry.name)) {
        testFiles.push(normalizePath(relativePath))
      }
    }
  }

  for (const directory of ["server", "src", "scripts"]) {
    await walk(directory)
  }

  return testFiles.sort()
}
