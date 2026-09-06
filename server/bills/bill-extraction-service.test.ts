import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractBill, extractBillCandidate, loadBillExtractChoice } from "./bill-extraction-service.ts";
import { createAnthropicProvider } from "./bill-extractors/anthropic.ts";
import { createOpenAiProvider } from "./bill-extractors/openai.ts";
import { BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS } from "./bill-semantic-prompt.ts";
interface TestStatement { sql: string; args?: unknown[] }

interface MetadataFixture {
  accounts?: unknown[];
  payees?: unknown[];
  categories?: unknown[];
  schedules?: unknown[];
  recentTransactions?: unknown[];
}

const mockDb = {
  execute: vi.fn<(statement: TestStatement) => Promise<{ rows: Array<Record<string, unknown>> }>>(),
  batch: vi.fn<(statements: TestStatement[]) => Promise<unknown>>(),
};
let currentMetadata: MetadataFixture | null = null;
const resolveApiKey = async (provider: "openai" | "anthropic") =>
  process.env[provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"] || null;
const providers = {
  anthropic: createAnthropicProvider({ resolveApiKey }),
  openai: createOpenAiProvider({ resolveApiKey }),
};

const originalFetch = global.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

function rowResult(rows: Array<Record<string, unknown>> = []) {
  return { rows };
}

function mockSettings(provider: string, model: string, { metadata = null }: { metadata?: MetadataFixture | null } = {}) {
  currentMetadata = metadata;
  mockDb.execute.mockImplementation(({ sql }) => {
    if (/bill_extract_provider/i.test(sql)) {
      return Promise.resolve({
        rows: [{ bill_extract_provider: provider, bill_extract_model: model }],
      });
    }
    return Promise.resolve(rowResult());
  });
}

const dependencies = () => ({
  dbClient: mockDb as never,
  metadataReader: async () => ({
    accounts: currentMetadata?.accounts || [],
    payees: currentMetadata?.payees || [],
    payeeMap: {},
    categories: currentMetadata?.categories || [],
    schedules: currentMetadata?.schedules || [],
    recentTransactions: currentMetadata?.recentTransactions || [],
    syncHealth: { state: "current", lastSuccessAt: "2026-05-06T12:00:00.000Z" },
  }) as never,
  providers,
});

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  currentMetadata = null;
  mockDb.execute.mockReset();
  mockDb.batch.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe("loadBillExtractChoice", () => {
  it("returns the stored provider/model when allowed", async () => {
    mockSettings("openai", "gpt-5.4-mini");
    expect(await loadBillExtractChoice("u1", { dbClient: mockDb as never })).toEqual({ provider: "openai", model: "gpt-5.4-mini" });
  });

  it("falls back to the defaults for unknown models or settings read failures", async () => {
    mockSettings("openai", "not-a-real-model");
    expect(await loadBillExtractChoice("u1", { dbClient: mockDb as never })).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });

    mockDb.execute.mockRejectedValue(new Error("db down"));
    expect(await loadBillExtractChoice("u1", { dbClient: mockDb as never })).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
  });
});

describe("extractBillCandidate", () => {
  it("performs one first-pass extraction and returns semantic candidate context without resolving mappings", async () => {
    mockSettings("openai", "gpt-5.4-mini", { metadata: {
      accounts: [{ id: "account-1", name: "Checking" }],
      payees: [{ id: "payee-1", name: "Costco" }],
      categories: [{ group: "Shopping", categories: [{ id: "category-1", name: "Household" }] }],
    } });
    const extract = vi.fn().mockResolvedValue({
      fields: {
        document_role: "merchant_receipt",
        payee: "Costco",
        amount: 84.12,
        amount_kind: "order_total",
        amount_candidates: [{ kind: "order_total", value: 84.12, evidence: "Order total $84.12", confidence: 0.99 }],
        event_kind: "purchase",
        event_confidence: 0.99,
        event_evidence: "Thanks for your order",
        due_date: "2026-08-31",
        type: "expense",
        category_code: "c1",
        category_name: "Household",
        to_account_code: null,
      },
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const result = await extractBillCandidate(
      "u1",
      { from: "orders@costco.com", subject: "Your order", body: "Order total $84.12" },
      { ...dependencies(), providers: { ...providers, openai: { id: "openai", envVar: "OPENAI_API_KEY", extract } } as never },
    );

    expect(result).toMatchObject({
      candidate: {
        document_role: "merchant_receipt",
        payee: "Costco",
        amount: 84.12,
        amount_kind: "order_total",
        event_kind: "purchase",
        category_id: "category-1",
      },
      provider: "openai",
      model: "gpt-5.4-mini",
      metadata: {
        accounts: [{ id: "account-1", name: "Checking" }],
        payees: [{ id: "payee-1", name: "Costco" }],
      },
    });
    // test-architecture: allow-boundary-interaction -- The injected extraction provider is the outbound model boundary; exactly one first-pass request is the candidate-only API's spend contract.
    expect(extract).toHaveBeenCalledTimes(1);
    // test-architecture: allow-boundary-interaction -- The injected provider is the outbound model boundary; its prompt is the public extraction contract.
    expect(extract.mock.calls[0]![0].systemPrompt).toContain(BILL_SEMANTIC_EXTRACTION_INSTRUCTIONS);
  });
});

describe("extractBill (Anthropic)", () => {
  it("translates category/account codes back to real ids and reports the model used", async () => {
    mockSettings("anthropic", "claude-haiku-4-5", { metadata: {
      categories: [
        { group: "G1", categories: [{ id: "CAT-REAL-1", name: "Groceries" }] },
      ],
      accounts: [
        { id: "ACC-REAL-1", name: "Visa" },
      ],
      payees: [],
    } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            name: "submit_bill",
            input: {
              payee: "PG&E",
              currency: "USD",
              amount: 120,
              amount_kind: "total_due",
              amount_candidates: [{
                kind: "total_due",
                value: 120,
                evidence: "Total due $120.00",
                confidence: 0.99,
              }],
              event_kind: "bill_issued",
              event_confidence: 0.98,
              event_evidence: "Your bill is ready",
              due_date: "2026-05-01",
              type: "bill",
              category_code: "c1",
              category_name: "Groceries",
              to_account_code: null,
            },
          },
        ],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const out = await extractBill("u1", { subject: "Bill", from: "x@y", body: "body" }, dependencies());

    expect(out).toEqual({
      payee: "PG&E",
      currency: "USD",
      amount: 120,
      amount_kind: "total_due",
      amount_candidates: [{
        kind: "total_due",
        value: 120,
        evidence: "Total due $120.00",
        confidence: 0.99,
      }],
      event_kind: "bill_issued",
      event_confidence: 0.98,
      event_evidence: "Your bill is ready",
      due_date: "2026-05-01",
      type: "bill",
      category_id: "CAT-REAL-1",
      category_name: "Groceries",
      to_account_id: null,
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
    // test-architecture: allow-boundary-interaction -- Bill extraction fetch is an outbound document/provider boundary; source URL and model payload are the compatibility contract.
    const fetchUrl = fetchMock.mock.calls[0]![0];
    expect(fetchUrl).toContain("anthropic.com");
  });

  it("returns 502-shaped error when Anthropic response lacks tool_use", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSettings("anthropic", "claude-haiku-4-5");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    });

    await expect(
      extractBill("u1", { subject: "x", from: "y", body: "z" }, dependencies())
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe("extractBill (OpenAI)", () => {
  it("returns verifier-corrected amount evidence for an incomplete multi-amount first pass", async () => {
    mockSettings("openai", "gpt-5.4-mini");
    const response = (fields: Record<string, unknown>) => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          payee: "Example Bank",
          due_date: "2026-08-10",
          type: "transfer",
          category_code: null,
          category_name: null,
          to_account_code: null,
          ...fields,
        }),
        usage: { input_tokens: 100, output_tokens: 30 },
      }),
    });
    global.fetch = vi.fn()
      .mockResolvedValueOnce(response({
        amount: 40,
        amount_kind: "minimum_due",
        amount_candidates: [{ kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" }],
      }))
      .mockResolvedValueOnce(response({
        amount: 391.2,
        amount_kind: "statement_balance",
        amount_candidates: [
          { kind: "minimum_due", value: 40, evidence: "Minimum payment $40.00" },
          { kind: "other", value: 0, evidence: "Plan balance $0.00" },
          { kind: "statement_balance", value: 391.2, evidence: "Remaining statement balance $391.20" },
        ],
      })) as unknown as typeof fetch;

    const out = await extractBill("u1", {
      subject: "Payment due",
      from: "billing@example.test",
      body: "Minimum payment $40.00. Plan balance $0.00. Remaining statement balance $391.20.",
    }, dependencies());

    expect(out).toMatchObject({
      amount: 391.2,
      amount_kind: "statement_balance",
      amount_verification: {
        status: "corrected",
        source_value_count: 3,
        initial_covered_count: 1,
        verified_covered_count: 3,
      },
    });
  });

  it.each(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"])(
    "uses Responses API structured output and returns the same normalized shape (%s)",
    async (model) => {
      mockSettings("openai", model, { metadata: {
        categories: [
          { group: "G1", categories: [{ id: "CAT-REAL-2", name: "Internet" }] },
        ],
        accounts: [{ id: "ACC-REAL-2", name: "Visa" }],
        payees: [],
      } });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            payee: "Xfinity",
            amount: 95.99,
            amount_kind: "total_due",
            amount_candidates: [{
              kind: "total_due",
              value: 95.99,
              evidence: "Bill total $95.99",
              confidence: 0.99,
            }],
            event_kind: "bill_issued",
            event_confidence: 0.99,
            event_evidence: "Your bill is ready",
            due_date: "2026-05-10",
            type: "bill",
            category_code: "c1",
            category_name: "Internet",
            to_account_code: null,
          }),
          usage: { prompt_tokens: 200, completion_tokens: 40 },
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const out = await extractBill("u1", { subject: "Bill", from: "x@y", body: "body" }, dependencies());

      expect(out).toEqual({
        payee: "Xfinity",
        amount: 95.99,
        amount_kind: "total_due",
        amount_candidates: [{
          kind: "total_due",
          value: 95.99,
          evidence: "Bill total $95.99",
          confidence: 0.99,
        }],
        event_kind: "bill_issued",
        event_confidence: 0.99,
        event_evidence: "Your bill is ready",
        due_date: "2026-05-10",
        type: "bill",
        category_id: "CAT-REAL-2",
        category_name: "Internet",
        to_account_id: null,
        provider: "openai",
        model,
      });
      // test-architecture: allow-boundary-interaction -- Bill extraction fetch is an outbound document/provider boundary; source URL and model payload are the compatibility contract.
      const fetchUrl = fetchMock.mock.calls[0]![0];
      // test-architecture: allow-boundary-interaction -- Bill extraction fetch is an outbound document/provider boundary; source URL and model payload are the compatibility contract.
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      expect(fetchUrl).toContain("openai.com/v1/responses");
      expect(body.text.format.type).toBe("json_schema");
      expect(body.model).toBe(model);
    }
  );

  it("surfaces a clear unavailable error when OPENAI_API_KEY is missing", async () => {
    mockSettings("openai", "gpt-5.5");
    delete process.env.OPENAI_API_KEY;

    await expect(
      extractBill("u1", { subject: "x", from: "y", body: "z" }, dependencies())
    ).rejects.toMatchObject({ status: 503, message: /OPENAI_API_KEY not set/ });
  });
});
