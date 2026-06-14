import { describe, expect, it } from "vitest"
import { collectCrossDomainEdges, checkImportBoundaries } from "./import-boundaries.mjs"

const ENTRIES = {
  email: ["email-service.js", "search/email-search-answer.js"],
  bills: ["bills-service.js"],
  platform: ["*"],
}

function edge(consumer, target) {
  return { consumer, target }
}

describe("collectCrossDomainEdges", () => {
  it("captures imports that cross a domain boundary", () => {
    const files = [
      {
        path: "server/routes/settings.js",
        source: 'import { x } from "../email/gmail-sync.js"\n',
      },
    ]
    expect(collectCrossDomainEdges({ files, domains: ["email", "bills", "platform"] })).toEqual([
      edge("server/routes/settings.js", "server/email/gmail-sync.js"),
    ])
  })

  it("ignores same-domain imports, tests, test utils, and server/scripts", () => {
    const files = [
      {
        path: "server/email/email-service.js",
        source: 'import { x } from "./gmail-sync.js"\nimport { y } from "./search/email-search-answer.js"\n',
      },
      {
        path: "server/routes/settings.test.js",
        source: 'import { x } from "../email/gmail-sync.js"\n',
      },
      {
        path: "server/email/test-utils/email-index-db.js",
        source: 'import { x } from "../../bills/bill-extract.js"\n',
      },
      {
        path: "server/scripts/reindex-emails.js",
        source: 'import { x } from "../email/email-index.js"\n',
      },
    ]
    expect(collectCrossDomainEdges({ files, domains: ["email", "bills", "platform"] })).toEqual([])
  })

  it("captures dynamic imports and vi-free mock-less strings only when they resolve into a domain", () => {
    const files = [
      {
        path: "server/snapshots/snapshot-service.js",
        source: 'const mod = await import("../triage/triage-worker.js")\n',
      },
    ]
    expect(
      collectCrossDomainEdges({ files, domains: ["snapshots", "triage"] }),
    ).toEqual([edge("server/snapshots/snapshot-service.js", "server/triage/triage-worker.js")])
  })
})

describe("checkImportBoundaries", () => {
  it("allows imports of documented entry modules", () => {
    const edges = [edge("server/routes/briefing/email.js", "server/email/email-service.js")]
    const { failures } = checkImportBoundaries({ edges, entries: ENTRIES, baseline: [] })
    expect(failures).toEqual([])
  })

  it("allows nested entry modules", () => {
    const edges = [edge("server/routes/briefing/email.js", "server/email/search/email-search-answer.js")]
    const { failures } = checkImportBoundaries({ edges, entries: ENTRIES, baseline: [] })
    expect(failures).toEqual([])
  })

  it("treats every platform module as an entry", () => {
    const edges = [edge("server/email/gmail.js", "server/platform/encryption.js")]
    const { failures } = checkImportBoundaries({ edges, entries: ENTRIES, baseline: [] })
    expect(failures).toEqual([])
  })

  it("fails deep imports that are not in the baseline", () => {
    const edges = [edge("server/routes/settings.js", "server/email/gmail-sync.js")]
    const { failures } = checkImportBoundaries({ edges, entries: ENTRIES, baseline: [] })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain("server/routes/settings.js")
    expect(failures[0]).toContain("server/email/gmail-sync.js")
  })

  it("accepts grandfathered deep imports listed in the baseline", () => {
    const edges = [edge("server/routes/settings.js", "server/email/gmail-sync.js")]
    const { failures, warnings } = checkImportBoundaries({
      edges,
      entries: ENTRIES,
      baseline: ["server/routes/settings.js -> server/email/gmail-sync.js"],
    })
    expect(failures).toEqual([])
    expect(warnings).toEqual([])
  })

  it("warns about stale baseline entries so the ratchet only tightens", () => {
    const { warnings } = checkImportBoundaries({
      edges: [],
      entries: ENTRIES,
      baseline: ["server/routes/settings.js -> server/email/gmail-sync.js"],
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("no longer present")
  })

  it("never lets platform import a domain, even via the baseline", () => {
    const edges = [edge("server/platform/config-service.js", "server/email/email-index.js")]
    const { failures } = checkImportBoundaries({
      edges,
      entries: ENTRIES,
      baseline: ["server/platform/config-service.js -> server/email/email-index.js"],
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain("platform")
  })
})
