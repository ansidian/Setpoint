import { describe, expect, it } from "vitest";
import type { InstanceCredentialMetadata } from "../../shared/types/instance-credentials.ts";
import { projectCapabilityStatuses, type CapabilityProjectionInput } from "./capability-projection.ts";

function credential(
  key: string,
  overrides: Partial<InstanceCredentialMetadata> = {},
): InstanceCredentialMetadata {
  return {
    key,
    handling: "secret",
    capabilities: [],
    source: "absent",
    activeConfigured: false,
    pendingConfigured: false,
    validationState: "untested",
    lastTestedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    errorCode: null,
    version: null,
    ...overrides,
  };
}

function input(overrides: Partial<CapabilityProjectionInput> = {}): CapabilityProjectionInput {
  return {
    generatedAt: "2026-07-18T00:00:00.000Z",
    credentials: [],
    accounts: [],
    settings: {
      actualConfigured: false,
      discordConfigured: false,
      todoistConfigured: false,
      todoistMode: "disconnected",
      todoistNeedsReauth: false,
      weatherLocationConfigured: false,
    },
    actual: null,
    todoist: null,
    gmailRealtime: null,
    todoistAdvanced: null,
    ...overrides,
  };
}

function byId(result: ReturnType<typeof projectCapabilityStatuses>, id: string) {
  return result.capabilities.find((capability) => capability.id === id)!;
}

describe("capability projection", () => {
  it("returns every stable capability independently when nothing is configured", () => {
    const result = projectCapabilityStatuses(input());

    expect(result.capabilities.map(({ id }) => id)).toEqual([
      "email_calendar", "ai", "tasks", "weather", "finances", "notifications",
      "gmail_realtime", "todoist_advanced", "calendar_places",
    ]);
    expect(result.capabilities.every(({ state }) => state === "not_configured")).toBe(true);
  });

  it("keeps optional delivery and Places gaps from degrading healthy base capabilities", () => {
    const result = projectCapabilityStatuses(input({
      accounts: [{ type: "gmail", needsReauth: false }],
      credentials: [
        credential("google.oauth_client_id", { source: "stored", activeConfigured: true }),
        credential("google.oauth_client_secret", { source: "stored", activeConfigured: true }),
      ],
      settings: {
        actualConfigured: false,
        discordConfigured: false,
        todoistConfigured: true,
        todoistMode: "personal_token",
        todoistNeedsReauth: false,
        weatherLocationConfigured: false,
      },
      gmailRealtime: { configured: false, source: "absent", lastTestedAt: null, lastSucceededAt: null, lastFailedAt: null, errorCode: null },
    }));

    expect(byId(result, "email_calendar").state).toBe("ready");
    expect(byId(result, "tasks").state).toBe("ready");
    expect(byId(result, "gmail_realtime").state).toBe("not_configured");
    expect(byId(result, "todoist_advanced").state).toBe("not_configured");
    expect(byId(result, "calendar_places").state).toBe("not_configured");
  });

  it("represents partial AI availability and redacted validation evidence", () => {
    const result = projectCapabilityStatuses(input({ credentials: [
      credential("ai.openai_api_key", {
        source: "stored", activeConfigured: true, validationState: "valid",
        lastTestedAt: 100, lastSucceededAt: 100,
      }),
      credential("ai.anthropic_api_key", {
        source: "stored", activeConfigured: true, pendingConfigured: true,
        validationState: "invalid", lastTestedAt: 200, lastFailedAt: 200,
        errorCode: "RAW_PROVIDER_DETAIL_MUST_NOT_ESCAPE",
      }),
    ] }));

    expect(byId(result, "ai")).toMatchObject({
      state: "degraded",
      source: "stored",
      reasonCodes: ["AI_PROVIDER_PARTIAL", "CREDENTIAL_INVALID"],
      lastTestedAt: "1970-01-01T00:00:00.200Z",
    });
    expect(JSON.stringify(result)).not.toContain("RAW_PROVIDER_DETAIL_MUST_NOT_ESCAPE");
  });

  it("distinguishes reauth, pending, explicit disablement, and operational failure", () => {
    const result = projectCapabilityStatuses(input({
      accounts: [{ type: "gmail", needsReauth: true }, { type: "icloud", needsReauth: false }],
      credentials: [
        credential("weather.pirate_weather_api_key", { pendingConfigured: true, validationState: "pending" }),
        credential("calendar.google_places_api_key", { source: "disabled", validationState: "disabled" }),
        credential("google.oauth_client_id", { source: "stored", activeConfigured: true }),
        credential("google.oauth_client_secret", { source: "stored", activeConfigured: true }),
      ],
      settings: {
        actualConfigured: true,
        discordConfigured: true,
        todoistConfigured: true,
        todoistMode: "oauth",
        todoistNeedsReauth: true,
        weatherLocationConfigured: true,
      },
      actual: { status: "stale", lastSucceededAt: "2026-07-17T20:00:00.000Z", lastFailedAt: "2026-07-17T21:00:00.000Z" },
    }));

    expect(byId(result, "email_calendar")).toMatchObject({ state: "degraded", reasonCodes: ["ACCOUNT_REAUTH_REQUIRED", "CALENDAR_NOT_CONNECTED"] });
    expect(byId(result, "weather").state).toBe("pending");
    expect(byId(result, "calendar_places").state).toBe("disabled");
    expect(byId(result, "tasks")).toMatchObject({ state: "needs_attention", reasonCodes: ["TODOIST_REAUTH_REQUIRED"] });
    expect(byId(result, "finances")).toMatchObject({ state: "degraded", reasonCodes: ["OPERATION_FAILED"] });
  });
});
