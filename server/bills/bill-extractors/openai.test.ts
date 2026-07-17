import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENAI_PROVIDER } from "./openai.ts";

describe("OPENAI_PROVIDER.extract", () => {
  let savedApiKey: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (savedApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedApiKey;
    vi.restoreAllMocks();
  });

  it("sends the extraction request with an AbortSignal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          payee: "Acme",
          amount: 10,
          due_date: "2026-08-01",
          type: "bill",
          category_code: null,
          category_name: null,
          to_account_code: null,
        }),
        usage: {},
      }),
    } as Response);

    await OPENAI_PROVIDER.extract({ model: "gpt-5.5", systemPrompt: "extract", content: "bill text" });

    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
