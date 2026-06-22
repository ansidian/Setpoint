import { describe, expect, test } from "vitest"
import { checkSizeBaseline, isSizeCheckedSource } from "./component-sizes.mjs"

describe("isSizeCheckedSource", () => {
  test("governs .js source anywhere under src, not just /components/ or /pages/", () => {
    // The blind spot C2 closes: hooks and loose .js controllers/models were invisible.
    expect(isSizeCheckedSource("src/hooks/calendar/useCalendarModalController.jsx")).toBe(true)
    expect(isSizeCheckedSource("src/components/calendar/events/useCalendarEventEditor.js")).toBe(true)
    expect(isSizeCheckedSource("src/demo/store.js")).toBe(true)
    expect(isSizeCheckedSource("src/api.js")).toBe(true)
  })

  test("excludes test files and non-source assets", () => {
    expect(isSizeCheckedSource("src/components/inbox/InboxView.test.jsx")).toBe(false)
    expect(isSizeCheckedSource("src/hooks/foo.test.js")).toBe(false)
    expect(isSizeCheckedSource("src/index.css")).toBe(false)
    expect(isSizeCheckedSource("DESIGN.json")).toBe(false)
  })

  test("governs non-test source under server/, not just src/", () => {
    // The server tree was the blind spot that let 11 modules grow to 686-918 lines
    // with no size enforcement; the predicate is path-agnostic so it already governs them.
    expect(isSizeCheckedSource("server/email/gmail-sync.js")).toBe(true)
    expect(isSizeCheckedSource("server/triage/triage-worker.test.js")).toBe(false)
  })
})

describe("checkSizeBaseline", () => {
  const baseline = { threshold: 600, files: {} }

  test("fails an oversized file that is not in the baseline", () => {
    const files = [{ path: "src/components/Huge.jsx", lineCount: 742 }]
    const { failures } = checkSizeBaseline({ files, baseline })
    expect(failures).toEqual([
      "src/components/Huge.jsx is 742 lines and is not in the component-size baseline",
    ])
  })

  test("passes a file at or under the threshold with no baseline entry", () => {
    const files = [{ path: "src/components/Fine.jsx", lineCount: 600 }]
    expect(checkSizeBaseline({ files, baseline }).failures).toEqual([])
  })

  test("passes a grandfathered file at exactly its recorded allowance", () => {
    const grandfathered = { threshold: 600, files: { "src/demo/store.js": 815 } }
    const files = [{ path: "src/demo/store.js", lineCount: 815 }]
    expect(checkSizeBaseline({ files, baseline: grandfathered }).failures).toEqual([])
  })

  test("fails a grandfathered file that grew past its recorded allowance", () => {
    const grandfathered = { threshold: 600, files: { "src/demo/store.js": 815 } }
    const files = [{ path: "src/demo/store.js", lineCount: 816 }]
    expect(checkSizeBaseline({ files, baseline: grandfathered }).failures).toEqual([
      "src/demo/store.js grew from baseline 815 lines to 816; decompose or update the baseline with justification",
    ])
  })

  test("warns to remove a baseline entry that no longer exceeds the threshold", () => {
    const grandfathered = { threshold: 600, files: { "src/demo/store.js": 815 } }
    const files = [{ path: "src/demo/store.js", lineCount: 540 }]
    const { failures, warnings } = checkSizeBaseline({ files, baseline: grandfathered })
    expect(failures).toEqual([])
    expect(warnings).toContain(
      "src/demo/store.js is in the component-size baseline but no longer exceeds 600 lines; remove it from the baseline",
    )
  })

  test("summarizes oversized debt sorted by line count, largest first", () => {
    const grandfathered = {
      threshold: 600,
      files: { "src/a.js": 700, "src/b.js": 900 },
    }
    const files = [
      { path: "src/a.js", lineCount: 700 },
      { path: "src/b.js", lineCount: 900 },
    ]
    const { warnings } = checkSizeBaseline({ files, baseline: grandfathered })
    expect(warnings).toContain(
      "Oversized source-file debt above 600 lines:\n  - src/b.js: 900\n  - src/a.js: 700",
    )
  })
})
