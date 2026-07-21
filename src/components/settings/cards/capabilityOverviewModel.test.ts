import { describe, expect, it } from "vitest";
import type { CapabilityStatus } from "../../../../shared/types/capabilities";
import { projectCapabilityStatus } from "./capabilityOverviewModel";

const capability = (overrides: Partial<CapabilityStatus>): CapabilityStatus => ({
  id: "ai",
  state: "ready",
  source: "stored",
  mode: "openai",
  reasonCodes: [],
  availableActions: ["manage"],
  guidanceRef: "setup.ai",
  lastTestedAt: null,
  lastSucceededAt: null,
  lastFailedAt: null,
  ...overrides,
});

describe("projectCapabilityStatus", () => {
  it.each([
    [capability({ state: "ready" }), "Working", "success"],
    [capability({ state: "degraded" }), "Partially working", "warning"],
    [capability({ state: "pending" }), "Pending validation", "accent"],
    [capability({ state: "needs_attention", reasonCodes: ["ACCOUNT_REAUTH_REQUIRED"] }), "Reconnect needed", "danger"],
    [capability({ state: "disabled", source: "disabled" }), "Disabled", "neutral"],
  ] as const)("projects stable state copy and tone", (input, label, tone) => {
    expect(projectCapabilityStatus(input)).toMatchObject({ label, tone });
  });

  it("presents skipped Gmail realtime as a healthy periodic mode", () => {
    expect(projectCapabilityStatus(capability({
      id: "gmail_realtime",
      state: "not_configured",
      source: "absent",
      mode: "periodic",
      guidanceRef: "setup.gmail_realtime",
    }))).toMatchObject({ label: "Periodic updates", tone: "success", optional: true });
  });

  it("presents personal-token Todoist as a valid basic mode", () => {
    expect(projectCapabilityStatus(capability({
      id: "todoist_advanced",
      state: "not_configured",
      source: "absent",
      mode: "periodic",
      guidanceRef: "setup.todoist_advanced",
    }))).toMatchObject({ label: "Personal token + periodic sync", tone: "success", optional: true });
  });
});
