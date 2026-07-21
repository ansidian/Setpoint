import { describe, expect, it } from "vitest";
import {
  credentialErrorMessage,
  credentialStatusView,
  formatCredentialTimestamp,
  pendingCredentialExpiryLabel,
} from "./coreCredentialModel";
import type { InstanceCredentialMetadata } from "../../../../shared/types/instance-credentials";

const base: InstanceCredentialMetadata = {
  key: "ai.openai_api_key",
  handling: "secret",
  capabilities: ["email_triage"],
  source: "stored",
  activeConfigured: true,
  pendingConfigured: false,
  validationState: "valid",
  lastTestedAt: Date.UTC(2026, 6, 17, 12),
  lastSucceededAt: Date.UTC(2026, 6, 17, 12),
  lastFailedAt: null,
  errorCode: null,
  version: 3,
  pendingStagedAt: null,
  pendingExpiresAt: null,
};

describe("core credential presentation model", () => {
  it("keeps a working active credential distinct from a failed pending replacement", () => {
    expect(credentialStatusView({
      ...base,
      pendingConfigured: true,
      validationState: "invalid",
      errorCode: "INVALID_CREDENTIAL",
    })).toEqual({
      activeLabel: "Setpoint",
      activeTone: "success",
      pendingLabel: "Pending replacement failed",
      pendingTone: "danger",
    });
  });

  it("describes environment and disabled sources without implying the value is visible", () => {
    expect(credentialStatusView({ ...base, source: "environment", validationState: "untested" }).activeLabel)
      .toBe("Host environment");
    expect(credentialStatusView({
      ...base,
      source: "disabled",
      activeConfigured: false,
      validationState: "disabled",
    }).activeLabel).toBe("Disabled");
  });

  it("maps stable backend codes to redacted actionable guidance", () => {
    expect(credentialErrorMessage("INVALID_CREDENTIAL")).toMatch(/check the value/i);
    expect(credentialErrorMessage("RATE_LIMITED")).toMatch(/try again/i);
    expect(credentialErrorMessage("unknown-provider-detail")).toBe("The credential could not be validated.");
  });

  it("formats metadata timestamps without exposing credential material", () => {
    expect(formatCredentialTimestamp(base.lastSucceededAt)).toContain("2026");
    expect(formatCredentialTimestamp(null)).toBeNull();
  });

  it("describes when a pending candidate expires without exposing its value", () => {
    const expiresAt = Date.UTC(2026, 6, 21, 18);
    expect(pendingCredentialExpiryLabel({
      ...base,
      pendingConfigured: true,
      pendingExpiresAt: expiresAt,
    })).toBe(`Pending candidate expires ${formatCredentialTimestamp(expiresAt)}`);
    expect(pendingCredentialExpiryLabel({ ...base, pendingExpiresAt: expiresAt })).toBeNull();
  });
});
