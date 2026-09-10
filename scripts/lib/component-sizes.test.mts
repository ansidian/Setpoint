import { describe, expect, test } from "vitest"
import {
  checkSizeBaseline,
  isSizeCheckedSource,
  isSizeCheckedTest,
  reportSourceFileSizes,
} from "./component-sizes.mts"

describe("isSizeCheckedSource", () => {
  test("governs .ts source anywhere under src, not just /components/ or /pages/", () => {
    // The blind spot C2 closes: hooks and loose .ts controllers/models were invisible.
    expect(isSizeCheckedSource("src/hooks/calendar/useCalendarModalController.tsx")).toBe(true)
    expect(isSizeCheckedSource("src/components/calendar/events/useCalendarEventEditor.ts")).toBe(true)
    expect(isSizeCheckedSource("src/demo/store.ts")).toBe(true)
    expect(isSizeCheckedSource("src/api.ts")).toBe(true)
  })

  test("excludes test files and non-source assets", () => {
    expect(isSizeCheckedSource("src/components/inbox/InboxView.test.tsx")).toBe(false)
    expect(isSizeCheckedSource("src/hooks/foo.test.ts")).toBe(false)
    expect(isSizeCheckedSource("src/index.css")).toBe(false)
    expect(isSizeCheckedSource("DESIGN.json")).toBe(false)
  })

  test("governs non-test source under server/, not just src/", () => {
    // The server tree was the blind spot that let 11 modules grow to 686-918 lines
    // outside the original size report; the predicate covers both trees.
    expect(isSizeCheckedSource("server/email/gmail-sync.ts")).toBe(true)
    expect(isSizeCheckedSource("server/triage/triage-worker.test.ts")).toBe(false)
  })
})

describe("source-size advisory", () => {
  test("reports oversized source without failing, regardless of its size", () => {
    const result = reportSourceFileSizes([
      { path: "src/components/calendar/modal/CalendarGrid.tsx", lineCount: 601 },
      { path: "server/email/gmail-sync.ts", lineCount: 1500 },
      { path: "src/api.ts", lineCount: 600 },
    ])
    expect(result).toEqual({
      failures: [],
      warnings: [
        "Source files above 600 lines (advisory only; review responsibilities and interfaces):\n  - server/email/gmail-sync.ts: 1500\n  - src/components/calendar/modal/CalendarGrid.tsx: 601",
      ],
    })
  })

  test("stays quiet when no source exceeds the review threshold", () => {
    expect(reportSourceFileSizes([
      { path: "src/api.ts", lineCount: 600 },
      { path: "src/main.tsx", lineCount: 20 },
    ])).toEqual({ failures: [], warnings: [] })
    expect(reportSourceFileSizes([])).toEqual({ failures: [], warnings: [] })
  })
})

describe("test-size baseline", () => {
  const baseline = { threshold: 600, files: {} }

  test("fails an oversized file that is not in the baseline", () => {
    const files = [{ path: "src/components/Huge.test.tsx", lineCount: 742 }]
    const { failures } = checkSizeBaseline({ files, baseline })
    expect(failures).toEqual([
      "src/components/Huge.test.tsx is 742 lines and is not in the test-size baseline",
    ])
  })

  test("passes a file at or under the threshold with no baseline entry", () => {
    const files = [{ path: "src/components/Fine.test.tsx", lineCount: 600 }]
    expect(checkSizeBaseline({ files, baseline }).failures).toEqual([])
  })

  test("passes a grandfathered file at exactly its recorded allowance", () => {
    const grandfathered = { threshold: 600, files: { "src/demo/store.test.ts": 815 } }
    const files = [{ path: "src/demo/store.test.ts", lineCount: 815 }]
    expect(checkSizeBaseline({ files, baseline: grandfathered }).failures).toEqual([])
  })

  test("fails a grandfathered file that grew past its recorded allowance", () => {
    const grandfathered = { threshold: 600, files: { "src/demo/store.test.ts": 815 } }
    const files = [{ path: "src/demo/store.test.ts", lineCount: 816 }]
    expect(checkSizeBaseline({ files, baseline: grandfathered }).failures).toEqual([
      "src/demo/store.test.ts grew from baseline 815 lines to 816; decompose or update the baseline with justification",
    ])
  })

  test("warns to remove a baseline entry that no longer exceeds the threshold", () => {
    const grandfathered = { threshold: 600, files: { "src/demo/store.test.ts": 815 } }
    const files = [{ path: "src/demo/store.test.ts", lineCount: 540 }]
    const { failures, warnings } = checkSizeBaseline({ files, baseline: grandfathered })
    expect(failures).toEqual([])
    expect(warnings).toContain(
      "src/demo/store.test.ts is in the test-size baseline but no longer exceeds 600 lines; remove it from the baseline",
    )
  })

  test("summarizes oversized debt sorted by line count, largest first", () => {
    const grandfathered = {
      threshold: 600,
      files: { "src/a.test.ts": 700, "src/b.test.ts": 900 },
    }
    const files = [
      { path: "src/a.test.ts", lineCount: 700 },
      { path: "src/b.test.ts", lineCount: 900 },
    ]
    const { warnings } = checkSizeBaseline({ files, baseline: grandfathered })
    expect(warnings).toContain(
      "Oversized test-file debt above 600 lines:\n  - src/b.test.ts: 900\n  - src/a.test.ts: 700",
    )
  })
})

describe("oversized test-file ratchet", () => {
  test("governs Vitest TypeScript files without treating test infrastructure as production source", () => {
    expect(isSizeCheckedTest("src/components/inbox/InboxView.test.tsx")).toBe(true)
    expect(isSizeCheckedTest("server/email/email-service.test.ts")).toBe(true)
    expect(isSizeCheckedTest("scripts/lib/component-sizes.test.mts")).toBe(true)
    expect(isSizeCheckedTest("src/components/calendar/CalendarModal.test-utils.tsx")).toBe(false)
    expect(isSizeCheckedTest("src/components/inbox/InboxView.tsx")).toBe(false)
  })

  test("rejects a new oversized test while allowing a grandfathered file at its exact allowance", () => {
    const files = [
      { path: "src/components/NewSurface.test.tsx", lineCount: 601 },
      { path: "server/email/legacy.test.ts", lineCount: 725 },
    ]
    const baseline = {
      threshold: 600,
      files: { "server/email/legacy.test.ts": 725 },
    }

    expect(checkSizeBaseline({
      files,
      baseline,
      baselineName: "test-size",
      debtName: "test-file",
    }).failures).toEqual([
      "src/components/NewSurface.test.tsx is 601 lines and is not in the test-size baseline",
    ])
  })
})
