import { describe, expect, it } from "vitest";
import { triageStatementsForEmail } from "./gmailTriageStatements.ts";

describe("triageStatementsForEmail", () => {
  it("builds INSERT OR IGNORE triage + ON CONFLICT job, arrivalGrace=false", () => {
    const [triage, job] = triageStatementsForEmail("u", "acct", { uid: "uid1", subject: "S" }, {
      arrivalGrace: false,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });
    expect(triage!.args).toEqual(["u", "acct", "uid1", "unknown"]);
    expect(JSON.parse(String(job!.args[4]))).toEqual({ uid: "uid1", subject: "S" });
    expect(job!.args[5]).toBe(null); // scheduled_for null when no grace
  });

  it("arrivalGrace=true uses arrival_grace source and a +30s scheduled_for", () => {
    const [triage, job] = triageStatementsForEmail("u", "acct", { uid: "uid1" }, {
      arrivalGrace: true,
      now: new Date("2026-05-03T12:00:00.000Z"),
    });
    expect(triage!.args[3]).toBe("arrival_grace");
    expect(job!.args[5]).toBe("2026-05-03T12:00:30.000Z");
    expect(JSON.parse(String(job!.args[4]))).toMatchObject({ arrivalGrace: true, graceDeadline: "2026-05-03T12:00:30.000Z" });
  });
});
