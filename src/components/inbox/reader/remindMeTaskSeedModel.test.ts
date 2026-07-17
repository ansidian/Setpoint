import { describe, expect, it } from "vitest";
import { laComponents } from "../../../lib/dashboard-helpers";
import { buildRemindMeTaskSeed } from "./remindMeTaskSeedModel";

const base = { subject: "Renew coverage", from: "Agent", fromEmail: "agent@example.test", summary: "Coverage expires soon." };

describe("buildRemindMeTaskSeed", () => {
  it("uses substantive persisted actions and bounded provenance without body content", () => {
    const seed = buildRemindMeTaskSeed({ ...base, action: "Submit renewal", body: "SECRET RAW BODY" }, 0);
    expect(seed.title).toBe("Submit renewal");
    expect(seed.description).toContain("Coverage expires soon.\n\nFrom: Agent <agent@example.test>\nSubject: Renew coverage");
    expect(seed.description).not.toContain("SECRET RAW BODY");
  });

  it.each(["", "Review", "Ignore", "No action needed"])("falls back from generic action %j to subject", (action) => {
    expect(buildRemindMeTaskSeed({ ...base, action }, 0).title).toBe("Renew coverage");
  });

  it("seeds date-only deadlines at 9am on the preceding Pacific day", () => {
    const seed = buildRemindMeTaskSeed({ ...base, action: "Renew", deadline_at: "2026-03-09" }, 0);
    expect(laComponents(seed.dueEpochMs!)).toMatchObject({ year: 2026, month: 2, day: 8, hour: 9, minute: 0 });
  });

  it("treats persisted UTC midnight as date-only", () => {
    const seed = buildRemindMeTaskSeed({ ...base, action: "Renew", deadline_at: "2026-03-09T00:00:00.000Z" }, 0);
    expect(laComponents(seed.dueEpochMs!)).toMatchObject({ year: 2026, month: 2, day: 8, hour: 9, minute: 0 });
  });

  it("preserves Pacific wall time across DST while subtracting a calendar day", () => {
    const seed = buildRemindMeTaskSeed({ ...base, action: "Renew", deadline_at: "2026-03-09T17:30:00Z" }, 0);
    expect(laComponents(seed.dueEpochMs!)).toMatchObject({ year: 2026, month: 2, day: 8, hour: 10, minute: 30 });
  });

  it("leaves past and missing due values unset while retaining detected context", () => {
    const past = buildRemindMeTaskSeed({ ...base, action: "Renew", deadline_at: "2026-01-02" }, Date.parse("2026-07-17T00:00:00Z"));
    expect(past.dueEpochMs).toBeNull();
    expect(past.detectedDateLabel).toBeTruthy();
    expect(buildRemindMeTaskSeed({ ...base, action: "Renew" }, 0).dueEpochMs).toBeNull();
  });

  it("keeps untriaged entry manual and carries only provenance", () => {
    const seed = buildRemindMeTaskSeed({ ...base, _untriaged: true, action: "Ignored action" }, 0);
    expect(seed).toMatchObject({ title: "", dueEpochMs: null, triaged: false });
    expect(seed.description).not.toContain("Coverage expires soon.");
  });
});
