import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockActual = {
  sendBill: vi.fn(),
  markBillPaid: vi.fn(),
  getAccounts: vi.fn(),
  getCategories: vi.fn(),
  getPayees: vi.fn(),
  getMetadata: vi.fn(),
  testConnection: vi.fn(),
  createQuickTxn: vi.fn(),
};
const mockDb = { execute: vi.fn() };
vi.mock("./actual.js", () => mockActual);
vi.mock("./bill-extract.js", () => ({ trimBillBody: ({ body }) => body.slice(0, 100) }));
vi.mock("../db/connection.js", () => ({ default: mockDb }));

const originalFetch = global.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

function mockSettings(provider, model) {
  mockDb.execute.mockResolvedValueOnce({
    rows: [{ bill_extract_provider: provider, bill_extract_model: model }],
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  Object.values(mockActual).forEach((fn) => fn.mockReset());
  mockDb.execute.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  process.env.OPENAI_API_KEY = originalOpenAiKey;
});

const { extractBill, sendBill, listAccounts } = await import("./bills-service.js");

describe("extractBill (Anthropic)", () => {
  it("translates category/account codes back to real ids and reports the model used", async () => {
    mockSettings("anthropic", "claude-haiku-4-5");
    mockActual.getCategories.mockResolvedValueOnce([
      { group: "G1", categories: [{ id: "CAT-REAL-1", name: "Groceries" }] },
    ]);
    mockActual.getAccounts.mockResolvedValueOnce([
      { id: "ACC-REAL-1", name: "Visa" },
    ]);
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
    });
    const fetchUrl = global.fetch.mock.calls[0][0];
    expect(fetchUrl).toContain("anthropic.com");
  });

  it("returns 502-shaped error when Anthropic response lacks tool_use", async () => {
    mockSettings("anthropic", "claude-haiku-4-5");
    mockActual.getCategories.mockResolvedValueOnce([]);
    mockActual.getAccounts.mockResolvedValueOnce([]);
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
      mockSettings("openai", model);
      mockActual.getCategories.mockResolvedValueOnce([
        { group: "G1", categories: [{ id: "CAT-REAL-2", name: "Internet" }] },
      ]);
      mockActual.getAccounts.mockResolvedValueOnce([{ id: "ACC-REAL-2", name: "Visa" }]);
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
    mockActual.getCategories.mockResolvedValueOnce([]);
    mockActual.getAccounts.mockResolvedValueOnce([]);

    await expect(
      extractBill("u1", { subject: "x", from: "y", body: "z" })
    ).rejects.toMatchObject({ status: 503, message: /OPENAI_API_KEY not set/ });
  });
});

describe("sendBill", () => {
  it("forwards to actual.sendBill", async () => {
    mockActual.sendBill.mockResolvedValueOnce({ id: "bill-1" });
    const out = await sendBill("u1", { payee: "x", amount: 10, type: "bill" });
    expect(out).toEqual({ id: "bill-1" });
    expect(mockActual.sendBill).toHaveBeenCalledWith({ payee: "x", amount: 10, type: "bill" }, "u1");
  });
});

describe("listAccounts", () => {
  it("passes through to actual.getAccounts", async () => {
    mockActual.getAccounts.mockResolvedValueOnce([{ id: "a1" }]);
    const out = await listAccounts("u1");
    expect(out).toEqual([{ id: "a1" }]);
  });
});
