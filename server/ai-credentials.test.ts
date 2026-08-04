import { describe, expect, it, vi } from "vitest";
import {
  aiCredentialKey,
  createAiCredentialManager,
  resolveAiApiKey,
} from "./ai-credentials.ts";

describe("AI credentials", () => {
  it("maps providers to the allowlisted registry keys and resolves the current value", async () => {
    let resolvedKey: string | undefined;
    const resolve = async (key: string) => {
      resolvedKey = key;
      return {
      key: "ai.openai_api_key" as const,
      source: "stored" as const,
      value: "rotated-key",
      };
    };

    expect(aiCredentialKey("openai")).toBe("ai.openai_api_key");
    expect(aiCredentialKey("anthropic")).toBe("ai.anthropic_api_key");
    await expect(resolveAiApiKey("openai", { resolve } as never)).resolves.toBe("rotated-key");
    expect(resolvedKey).toBe("ai.openai_api_key");
  });

  it("tests and atomically promotes a valid pending OpenAI key without returning it", async () => {
    const promotions: Array<[string, number]> = [];
    const failures: unknown[] = [];
    const credentials = {
      readPending: vi.fn(async () => ({ value: "candidate-secret", version: 4 })),
      promotePending: async (key: string, version: number) => {
        promotions.push([key, version]);
        return { key: "ai.openai_api_key", version: 5 };
      },
      recordPendingFailure: (...args: unknown[]) => { failures.push(args); },
    };
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: "Bearer candidate-secret" });
      return { ok: true, status: 200 };
    });
    const manager = createAiCredentialManager({ credentials: credentials as never, fetchImpl: fetchImpl as never });

    const result = await manager.testPending("ai.openai_api_key");

    expect(result).toEqual({ ok: true, code: "VALID", metadata: { key: "ai.openai_api_key", version: 5 } });
    expect(JSON.stringify(result)).not.toContain("candidate-secret");
    expect(promotions).toEqual([["ai.openai_api_key", 4]]);
    expect(failures).toEqual([]);
  });

  it("records a stable redacted failure and preserves the active credential", async () => {
    const promotions: unknown[] = [];
    const failures: Array<[string, number, string]> = [];
    const credentials = {
      readPending: vi.fn(async () => ({ value: "bad-secret", version: 8 })),
      promotePending: (...args: unknown[]) => { promotions.push(args); },
      recordPendingFailure: async (key: string, version: number, code: string) => {
        failures.push([key, version, code]);
        return { key: "ai.anthropic_api_key", version: 9 };
      },
      resolve: vi.fn(async () => ({
        key: "ai.anthropic_api_key",
        source: "stored",
        value: "working-secret",
      })),
    };
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));
    const manager = createAiCredentialManager({ credentials: credentials as never, fetchImpl: fetchImpl as never });

    const result = await manager.testPending("ai.anthropic_api_key");

    expect(result).toEqual({
      ok: false,
      code: "INVALID_CREDENTIAL",
      metadata: { key: "ai.anthropic_api_key", version: 9 },
    });
    expect(JSON.stringify(result)).not.toContain("bad-secret");
    expect(failures).toEqual([["ai.anthropic_api_key", 8, "INVALID_CREDENTIAL"]]);
    expect(promotions).toEqual([]);
    await expect(resolveAiApiKey("anthropic", credentials as never)).resolves.toBe("working-secret");
  });

  it("rejects non-AI keys without reading pending secret material", async () => {
    let readPending = false;
    const credentials = { readPending: () => { readPending = true; } };
    const manager = createAiCredentialManager({ credentials: credentials as never, fetchImpl: vi.fn() as never });
    await expect(manager.testPending("weather.pirate_weather_api_key")).rejects.toMatchObject({
      code: "UNKNOWN_AI_CREDENTIAL",
      status: 404,
    });
    expect(readPending).toBe(false);
  });
});
