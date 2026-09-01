import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenAiProvider } from "./openai.ts";

const OPENAI_PROVIDER = createOpenAiProvider({
  resolveApiKey: async () => process.env.OPENAI_API_KEY || null,
});

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

    // test-architecture: allow-boundary-interaction -- OpenAI fetch is an outbound AI-provider boundary; timeout propagation is observable only on the request signal.
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    // test-architecture: allow-boundary-interaction -- The provider request schema is the public outbound extraction contract; no returned value can prove which schema was sent.
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text.format.schema.properties.amount_candidates.items.properties.kind.enum)
      .toContain("statement_balance");
    expect(body.text.format.schema.properties.event_kind.enum)
      .toContain("payment_completed");
    expect(body.text.format.schema.properties.account_last4.pattern).toBe("^[0-9]{4}$");
    expect(body.text.format.schema.required).toContain("account_last4_evidence");
    expect(body.text.format.schema.properties.target_policy_key.type).toContain("null");
  });
});
