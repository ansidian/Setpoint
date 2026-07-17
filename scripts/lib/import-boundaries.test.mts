import { describe, expect, it } from "vitest"
import { collectCrossDomainEdges, checkImportBoundaries } from "./import-boundaries.mts"

const ENTRIES = {
  email: ["email-service.ts", "search/email-search-answer.ts"],
  bills: ["bills-service.ts"],
  platform: ["*"],
}

function edge(consumer: string, target: string) {
  return { consumer, target }
}

describe("collectCrossDomainEdges", () => {
  it("captures imports that cross a domain boundary", () => {
    const files = [
      {
        path: "server/routes/settings.ts",
        source: 'import { x } from "../email/gmail-sync.ts"\n',
      },
    ]
    expect(collectCrossDomainEdges({ files, domains: ["email", "bills", "platform"] })).toEqual([
      edge("server/routes/settings.ts", "server/email/gmail-sync.ts"),
    ])
  })

  it("ignores same-domain imports, tests, test utils, and server/scripts", () => {
    const files = [
      {
        path: "server/email/email-service.ts",
        source: 'import { x } from "./gmail-sync.ts"\nimport { y } from "./search/email-search-answer.ts"\n',
      },
      {
        path: "server/routes/settings.test.ts",
        source: 'import { x } from "../email/gmail-sync.ts"\n',
      },
      {
        path: "server/email/test-utils/email-index-db.ts",
        source: 'import { x } from "../../bills/bill-extract.ts"\n',
      },
      {
        path: "server/scripts/reindex-emails.ts",
        source: 'import { x } from "../email/email-index.ts"\n',
      },
    ]
    expect(collectCrossDomainEdges({ files, domains: ["email", "bills", "platform"] })).toEqual([])
  })

  it("captures dynamic imports and vi-free mock-less strings only when they resolve into a domain", () => {
    const files = [
      {
        path: "server/snapshots/snapshot-service.ts",
        source: 'const mod = await import("../triage/triage-worker.ts")\n',
      },
    ]
    expect(
      collectCrossDomainEdges({ files, domains: ["snapshots", "triage"] }),
    ).toEqual([edge("server/snapshots/snapshot-service.ts", "server/triage/triage-worker.ts")])
  })
})

describe("checkImportBoundaries", () => {
  it("allows imports of documented entry modules", () => {
    const edges = [edge("server/routes/briefing/email.ts", "server/email/email-service.ts")]
    const { failures } = checkImportBoundaries({ edges, entries: ENTRIES, baseline: [] })
    expect(failures).toEqual([])
  })

  it("allows nested entry modules", () => {
    const edges = [edge("server/routes/briefing/email.ts", "server/email/search/email-search-answer.ts")]
    const { failures } = checkImportBoundaries({ edges, entries: ENTRIES, baseline: [] })
    expect(failures).toEqual([])
  })

  it("treats every platform module as an entry", () => {
    const edges = [edge("server/email/gmail.ts", "server/platform/encryption.ts")]
    const { failures } = checkImportBoundaries({ edges, entries: ENTRIES, baseline: [] })
    expect(failures).toEqual([])
  })

  it("fails deep imports that are not in the baseline", () => {
    const edges = [edge("server/routes/settings.ts", "server/email/gmail-sync.ts")]
    const { failures } = checkImportBoundaries({ edges, entries: ENTRIES, baseline: [] })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain("server/routes/settings.ts")
    expect(failures[0]).toContain("server/email/gmail-sync.ts")
  })

  it("accepts grandfathered deep imports listed in the baseline", () => {
    const edges = [edge("server/routes/settings.ts", "server/email/gmail-sync.ts")]
    const { failures, warnings } = checkImportBoundaries({
      edges,
      entries: ENTRIES,
      baseline: ["server/routes/settings.ts -> server/email/gmail-sync.ts"],
    })
    expect(failures).toEqual([])
    expect(warnings).toEqual([])
  })

  it("warns about stale baseline entries so the ratchet only tightens", () => {
    const { warnings } = checkImportBoundaries({
      edges: [],
      entries: ENTRIES,
      baseline: ["server/routes/settings.ts -> server/email/gmail-sync.ts"],
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("no longer present")
  })

  it("never lets platform import a domain, even via the baseline", () => {
    const edges = [edge("server/platform/config-service.ts", "server/email/email-index.ts")]
    const { failures } = checkImportBoundaries({
      edges,
      entries: ENTRIES,
      baseline: ["server/platform/config-service.ts -> server/email/email-index.ts"],
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain("platform")
  })
})
