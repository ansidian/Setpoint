import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANTHROPIC_PROVIDER } from "./anthropic.ts";

vi.mock("../../ai-credentials.ts", () => ({
  resolveAiApiKey: async () => process.env.ANTHROPIC_API_KEY || null,
}));

describe("ANTHROPIC_PROVIDER.extract", () => {
  let savedApiKey: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedApiKey;
    vi.restoreAllMocks();
  });

  it("sends the extraction request with an AbortSignal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "tool_use", name: "submit_bill", input: { payee: "Acme", amount: 10, due_date: "2026-08-01", type: "bill" } }],
        usage: {},
      }),
    } as Response);

    await ANTHROPIC_PROVIDER.extract({ model: "claude-haiku-4-5", systemPrompt: "extract", content: "bill text" });

    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
