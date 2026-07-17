import { describe, expect, it } from "vitest";
import { composeSystemStatus } from "./currentSystemStatusModel.ts";

describe("composeSystemStatus", () => {
  it("rolls a stale todoist mirror into needs_sync", () => {
    const out = composeSystemStatus({
      currentData: { state: "current", lastSuccessAt: null },
      todoist: { state: "stale", severity: "warning" },
      bills: { state: "current" },
    }, { generatedAt: "2026-06-21T00:00:00.000Z" });
    const todoist = out.sources.find((s) => s.key === "todoist");
    expect(todoist!.state).toBe("needs_sync");
    expect(out.generatedAt).toBe("2026-06-21T00:00:00.000Z");
  });

  it("derives a bills warning severity for needs_sync/degraded/stale", () => {
    const out = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "current" },
      bills: { state: "needs_sync" },
    });
    const bills = out.sources.find((s) => s.key === "bills");
    expect(bills!.severity).toBe("warning");
  });

  it("summarizes unavailable when any source is in error, needs_sync when a warning source needs sync", () => {
    const errorOut = composeSystemStatus({
      currentData: { state: "unavailable" },
      todoist: { state: "current" },
      bills: { state: "current" },
    });
    expect(errorOut.state).toBe("unavailable");

    const needsSyncOut = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "needs_sync", severity: "warning" },
      bills: { state: "current" },
    });
    expect(needsSyncOut.state).toBe("needs_sync");
  });

  it("appends a loud reauth source per flagged Gmail account plus Todoist, driving overall state unavailable", () => {
    const out = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "current" },
      bills: { state: "current" },
      reauth: {
        accounts: [{ id: "gmail-x", email: "a@b.c" }],
        todoist: true,
      },
    });

    expect(out.sources).toHaveLength(5);
    const accountSource = out.sources.find((s) => s.key === "reauth:gmail-x");
    expect(accountSource).toMatchObject({
      label: "Gmail (a@b.c)",
      state: "needs_reauth",
      severity: "error",
      lastSuccessAt: null,
      message: "Authorization revoked — reconnect this Google account in Settings.",
    });
    const todoistReauthSource = out.sources.find((s) => s.key === "reauth:todoist");
    expect(todoistReauthSource).toMatchObject({
      state: "needs_reauth",
      severity: "error",
    });
    expect(out.state).toBe("unavailable");
  });

  it("adds no reauth sources when providerHealth.reauth is absent or empty", () => {
    const out = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "current" },
      bills: { state: "current" },
    });
    expect(out.sources).toHaveLength(3);
    expect(out.sources.some((s) => s.key.startsWith("reauth:"))).toBe(false);

    const outEmpty = composeSystemStatus({
      currentData: { state: "current" },
      todoist: { state: "current" },
      bills: { state: "current" },
      reauth: { accounts: [], todoist: false },
    });
    expect(outEmpty.sources).toHaveLength(3);
  });
});
