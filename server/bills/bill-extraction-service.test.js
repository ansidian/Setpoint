import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockActual = {
  sendBill: vi.fn(),
  markBillPaid: vi.fn(),
  getMetadata: vi.fn(),
  testConnection: vi.fn(),
  createQuickTxn: vi.fn(),
};
const mockActualLocal = {
  describeLocalActualCache: vi.fn(),
  hydrateLocalActualCache: vi.fn(),
  readLocalActualMetadata: vi.fn(),
};
const mockDb = { execute: vi.fn(), batch: vi.fn() };
vi.mock("../actual/actual.js", () => mockActual);
vi.mock("../actual/actual-local-metadata.js", () => mockActualLocal);
vi.mock("./bill-extract.js", () => ({ trimBillBody: ({ body }) => body.slice(0, 100) }));
vi.mock("../db/connection.js", () => ({ default: mockDb }));

const originalFetch = global.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

function rowResult(rows = []) {
  return { rows };
}

function metadataProjectionRow(metadata = {}) {
  return {
    status: "current",
    accounts_json: JSON.stringify(metadata.accounts || []),
    payees_json: JSON.stringify(metadata.payees || []),
    categories_json: JSON.stringify(metadata.categories || []),
    schedules_json: JSON.stringify(metadata.schedules || []),
    recent_transactions_json: JSON.stringify(metadata.recentTransactions || []),
    last_success_at: "2026-05-06T12:00:00.000Z",
    last_attempt_at: "2026-05-06T12:00:00.000Z",
    last_error: null,
  };
}

function mockSettings(provider, model, { metadata = null } = {}) {
  mockDb.execute.mockImplementation(({ sql }) => {
    if (/bill_extract_provider/i.test(sql)) {
      return Promise.resolve({
        rows: [{ bill_extract_provider: provider, bill_extract_model: model }],
      });
    }
    if (/bill_pay_mappings_json/i.test(sql)) {
      return Promise.resolve({ rows: [{ bill_pay_mappings_json: null }] });
    }
    if (/ea_actual_metadata_mirror/i.test(sql) && metadata) {
      return Promise.resolve(rowResult([metadataProjectionRow(metadata)]));
    }
    return Promise.resolve(rowResult());
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  Object.values(mockActual).forEach((fn) => fn.mockReset());
  Object.values(mockActualLocal).forEach((fn) => fn.mockReset());
  mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("lightweight metadata unavailable"));
  mockDb.execute.mockReset();
  mockDb.batch.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  process.env.OPENAI_API_KEY = originalOpenAiKey;
});

const { extractBill, loadBillExtractChoice } = await import("./bill-extraction-service.js");

describe("loadBillExtractChoice", () => {
  it("returns the stored provider/model when allowed", async () => {
    mockSettings("openai", "gpt-5.4-mini");
    expect(await loadBillExtractChoice("u1")).toEqual({ provider: "openai", model: "gpt-5.4-mini" });
  });

  it("falls back to the defaults for unknown models or settings read failures", async () => {
    mockSettings("openai", "not-a-real-model");
    expect(await loadBillExtractChoice("u1")).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });

    mockDb.execute.mockRejectedValue(new Error("db down"));
    expect(await loadBillExtractChoice("u1")).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
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
    global.fetch = vi.fn().mockResolvedValue({
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

    const out = await extractBill("u1", { subject: "Bill", from: "x@y", body: "body" });

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
    const fetchUrl = global.fetch.mock.calls[0][0];
    expect(fetchUrl).toContain("anthropic.com");
  });

  it("returns 502-shaped error when Anthropic response lacks tool_use", async () => {
    mockSettings("anthropic", "claude-haiku-4-5");
    mockActual.getMetadata.mockResolvedValueOnce({ accounts: [], payees: [], categories: [] });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    });

    await expect(
      extractBill("u1", { subject: "x", from: "y", body: "z" })
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
      global.fetch = vi.fn().mockResolvedValue({
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

      const out = await extractBill("u1", { subject: "Bill", from: "x@y", body: "body" });

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
      const fetchUrl = global.fetch.mock.calls[0][0];
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(fetchUrl).toContain("openai.com/v1/responses");
      expect(body.text.format.type).toBe("json_schema");
      expect(body.model).toBe(model);
    }
  );

  it("surfaces a clear unavailable error when OPENAI_API_KEY is missing", async () => {
    mockSettings("openai", "gpt-5.5");
    delete process.env.OPENAI_API_KEY;
    mockActual.getMetadata.mockResolvedValueOnce({ accounts: [], payees: [], categories: [] });

    await expect(
      extractBill("u1", { subject: "x", from: "y", body: "z" })
    ).rejects.toMatchObject({ status: 503, message: /OPENAI_API_KEY not set/ });
  });
});
