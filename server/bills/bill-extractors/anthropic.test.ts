import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "./anthropic.ts";

const ANTHROPIC_PROVIDER = createAnthropicProvider({
  resolveApiKey: async () => process.env.ANTHROPIC_API_KEY || null,
});

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

    // test-architecture: allow-boundary-interaction -- Anthropic fetch is an outbound AI-provider boundary; timeout propagation is observable only on the request signal.
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    // test-architecture: allow-boundary-interaction -- The provider request schema is the public outbound extraction contract; no returned value can prove which schema was sent.
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.tools[0].input_schema.properties.amount_candidates.items.properties.kind.enum)
      .toContain("statement_balance");
    expect(body.tools[0].input_schema.properties.event_kind.enum)
      .toContain("payment_completed");
    expect(body.tools[0].input_schema.properties.account_last4.pattern).toBe("^[0-9]{4}$");
    expect(body.tools[0].input_schema.required).toContain("account_last4_evidence");
    expect(body.tools[0].input_schema.properties.target_policy_key.type).toContain("null");
  });
});
