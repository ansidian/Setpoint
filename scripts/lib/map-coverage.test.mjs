import { describe, expect, test } from "vitest"
import {
  checkMaps,
  isRequiredEntry,
  missingDocPaths,
  scopeOf,
  uncoveredThresholdViolations,
} from "./map-coverage.mjs"

describe("isRequiredEntry", () => {
  test("requires plain source files", () => {
    expect(isRequiredEntry("src/lib/triageSoundGate.js")).toBe(true)
    expect(isRequiredEntry("src/components/inbox/InboxView.jsx")).toBe(true)
  })

  test("excludes .test files", () => {
    expect(isRequiredEntry("src/App.test.jsx")).toBe(false)
    expect(isRequiredEntry("server/env.test.js")).toBe(false)
  })

  test("requires shared test infrastructure (spec rule 6)", () => {
    expect(isRequiredEntry("src/components/calendar/CalendarModal.test-utils.jsx")).toBe(true)
    expect(isRequiredEntry("src/components/calendar/CalendarEventEditor.test-setup.js")).toBe(true)
  })

  test("ignores non-source files", () => {
    expect(isRequiredEntry("src/index.css")).toBe(false)
    expect(isRequiredEntry("DESIGN.json")).toBe(false)
  })
})

describe("scopeOf", () => {
  const files = [
    "src/components/calendar/CalendarModal.jsx",
    "src/components/calendar/modal/CalendarSearchRail.jsx",
    "src/components/calendar/reminders/ReminderRow.jsx",
    "src/components/inbox/InboxView.jsx",
  ]
  const mapDirs = ["src/components/calendar", "src/components/calendar/modal"]

  test("covers own subtree excluding nested-mapped dirs", () => {
    expect(scopeOf("src/components/calendar", mapDirs, files)).toEqual([
      "src/components/calendar/CalendarModal.jsx",
      "src/components/calendar/reminders/ReminderRow.jsx",
    ])
  })

  test("nested map owns its subtree", () => {
    expect(scopeOf("src/components/calendar/modal", mapDirs, files)).toEqual([
      "src/components/calendar/modal/CalendarSearchRail.jsx",
    ])
  })
})

describe("checkMaps", () => {
  const files = [
    "src/widgets/CLAUDE.md",
    "src/widgets/alpha.js",
    "src/widgets/beta.jsx",
    "src/widgets/beta.test.jsx",
  ]

  test("fails when a scope file is missing from the map", () => {
    const maps = [{ dir: "src/widgets", text: "# Widgets Map\n- `alpha.js` — does alpha\n" }]
    const { failures } = checkMaps({ files, maps })
    expect(failures).toEqual(["src/widgets/CLAUDE.md missing entry for src/widgets/beta.jsx"])
  })

  test("passes when every scope file appears by name; tests not required", () => {
    const maps = [
      { dir: "src/widgets", text: "- `alpha.js` — does alpha\n- `beta.jsx` — does beta\n" },
    ]
    expect(checkMaps({ files, maps }).failures).toEqual([])
  })

  test("fails when the map names a file that does not exist", () => {
    const maps = [
      {
        dir: "src/widgets",
        text: "- `alpha.js` — a\n- `beta.jsx` — b\n- `gamma.js` — phantom\n",
      },
    ]
    expect(checkMaps({ files, maps }).failures).toEqual([
      "src/widgets/CLAUDE.md names missing file gamma.js",
    ])
  })

  test("resolves named files repo-root-relative too (Related sections)", () => {
    const maps = [
      {
        dir: "src/widgets",
        text: "- `alpha.js` — a\n- `beta.jsx` — b\nRelated: `src/widgets/alpha.js`\n",
      },
    ]
    expect(checkMaps({ files, maps }).failures).toEqual([])
  })

  test("warns past 60 entries unless acceptance comment present", () => {
    const many = Array.from({ length: 61 }, (_, i) => `src/big/f${i}.js`)
    const text = many.map((f) => `- \`${f.slice(8)}\` — x`).join("\n")
    const base = { files: [...many, "src/big/CLAUDE.md"] }
    expect(checkMaps({ ...base, maps: [{ dir: "src/big", text }] }).warnings).toHaveLength(1)
    expect(
      checkMaps({
        ...base,
        maps: [{ dir: "src/big", text: text + "\n<!-- map-scope-warning: accepted -->" }],
      }).warnings,
    ).toEqual([])
  })
})

describe("uncoveredThresholdViolations", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `src/heavy/f${i}.js`)

  test("fails an uncovered dir with >=20 DIRECT non-test source files", () => {
    expect(uncoveredThresholdViolations({ files: twenty, mapDirs: [] })).toEqual([
      "src/heavy has 20 non-test source files and no CLAUDE.md map coverage",
    ])
  })

  test("ancestor map coverage satisfies the rule", () => {
    expect(uncoveredThresholdViolations({ files: twenty, mapDirs: ["src/heavy"] })).toEqual([])
    expect(uncoveredThresholdViolations({ files: twenty, mapDirs: ["src"] })).toEqual([])
  })

  test("direct count does not roll up to ancestors (spec rule 3 amendment)", () => {
    const spread = [
      ...Array.from({ length: 15 }, (_, i) => `src/many/a/f${i}.js`),
      ...Array.from({ length: 15 }, (_, i) => `src/many/b/f${i}.js`),
    ]
    expect(uncoveredThresholdViolations({ files: spread, mapDirs: [] })).toEqual([])
  })

  test("test files do not count toward the threshold", () => {
    const tests = Array.from({ length: 25 }, (_, i) => `src/heavy/f${i}.test.js`)
    expect(uncoveredThresholdViolations({ files: tests, mapDirs: [] })).toEqual([])
  })
})

describe("missingDocPaths", () => {
  const files = ["server/briefing/bills-service.js"]

  test("accepts existing root-relative paths, with or without :function suffix", () => {
    const doc = "1. `server/briefing/bills-service.js:sendBill` — sends"
    expect(missingDocPaths(doc, files)).toEqual([])
  })

  test("reports phantom paths", () => {
    const doc = "1. `server/briefing/gone.js` — vanished"
    expect(missingDocPaths(doc, files)).toEqual(["server/briefing/gone.js"])
  })

  test("ignores bare filenames without a directory", () => {
    expect(missingDocPaths("see `bills-service.js`", files)).toEqual([])
  })
})
