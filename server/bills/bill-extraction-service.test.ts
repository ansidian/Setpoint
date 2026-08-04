import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractBill, loadBillExtractChoice } from "./bill-extraction-service.ts";
import { createAnthropicProvider } from "./bill-extractors/anthropic.ts";
import { createOpenAiProvider } from "./bill-extractors/openai.ts";
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
    if (/bill_pay_mappings_json/i.test(sql)) {
      return Promise.resolve({ rows: [{ bill_pay_mappings_json: null }] });
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
              amount: 120,
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
      amount: 120,
      due_date: "2026-05-01",
      type: "bill",
      category_id: "CAT-REAL-1",
      category_name: "Groceries",
      to_account_id: null,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      mapping: { status: "unmapped", reason: "no_profile_match", matchedProfiles: [] },
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
        due_date: "2026-05-10",
        type: "bill",
        category_id: "CAT-REAL-2",
        category_name: "Internet",
        to_account_id: null,
        provider: "openai",
        model,
        mapping: { status: "unmapped", reason: "no_profile_match", matchedProfiles: [] },
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
