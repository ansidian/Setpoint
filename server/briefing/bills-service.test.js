import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockActual = {
  sendBill: vi.fn(),
  markBillPaid: vi.fn(),
  getAccounts: vi.fn(),
  getCategories: vi.fn(),
  getPayees: vi.fn(),
  getMetadata: vi.fn(),
  getCalendarBillsRange: vi.fn(),
  testConnection: vi.fn(),
  createQuickTxn: vi.fn(),
};
const mockActualLocal = {
  describeLocalActualCache: vi.fn(),
  hydrateLocalActualCache: vi.fn(),
  readLocalActualMetadata: vi.fn(),
};
const mockDb = { execute: vi.fn(), batch: vi.fn() };
vi.mock("./actual.js", () => mockActual);
vi.mock("./actual-local-metadata.js", () => mockActualLocal);
vi.mock("./bill-extract.js", () => ({ trimBillBody: ({ body }) => body.slice(0, 100) }));
vi.mock("../db/connection.js", () => ({ default: mockDb }));

const originalFetch = global.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

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
  mockActualLocal.describeLocalActualCache.mockReset();
  mockActualLocal.describeLocalActualCache.mockResolvedValue({
    success: true,
    configured: true,
    hydrated: true,
    budgetId: "Budget-1",
  });
  mockActualLocal.hydrateLocalActualCache.mockReset();
  mockActualLocal.hydrateLocalActualCache.mockResolvedValue({
    success: true,
    hydrated: true,
    budgetId: "Budget-1",
    dbSizeBytes: 1024,
    backupCount: 1,
    backupSizeBytes: 512,
    backupPrune: { removed: 0, kept: 1 },
  });
  mockActualLocal.readLocalActualMetadata.mockReset();
  mockActualLocal.readLocalActualMetadata.mockRejectedValue(new Error("lightweight metadata unavailable"));
  mockActual.getPayees.mockResolvedValue([]);
  mockActual.getMetadata.mockResolvedValue({ accounts: [], payees: [], categories: [], schedules: [], recentTransactions: [] });
  mockDb.execute.mockReset();
  mockDb.batch.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  process.env.OPENAI_API_KEY = originalOpenAiKey;
});

const {
  extractBill,
  getMetadata,
  sendBill,
  listAccounts,
  readBillsMirrorRange,
  refreshBillsMirror,
  hydrateActualCache,
  scheduleBillsMirrorRefresh,
  consumeDueBillsMirrorRefresh,
  isBillsMirrorMaintenanceDue,
  resolveBillPaySeed,
  resolveBillPaySample,
} = await import("./bills-service.js");

function rowResult(rows = []) {
  return { rows };
}

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

describe("Bill Pay resolver service", () => {
  it("loads a triaged server candidate by email id before resolving without Actual metadata", async () => {
    mockDb.execute
      .mockResolvedValueOnce({
        rows: [{
          bill_pay_mappings_json: JSON.stringify({
            version: 1,
            profiles: [{
              id: "edison",
              enabled: true,
              identity: { aliases: ["edison"] },
              behaviors: [{
                id: "monthly",
                enabled: true,
                type: "expense",
                intent: { subject: ["bill"] },
                amountStrategy: "model_amount",
                targets: {
                  payee_id: "payee-edison",
                  payee_label: "Southern California Edison",
                  category_id: "cat-utilities",
                  category_label: "Utilities",
                },
              }],
            }],
          }),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          bill_candidate_json: JSON.stringify({
            payee_hint: "Edison",
            amount: 64.2,
            due_date: "2026-05-29",
          }),
          from_name: "Edison",
          from_address: "billing@sce.com",
          subject: "Your Edison bill",
          body_snippet: "Statement ready",
          body_text: "Statement ready",
        }],
      });

    const result = await resolveBillPaySeed("u1", {
      emailId: "msg-1",
      candidate: { payee_hint: "Client fallback", amount: 1 },
      source: "triage",
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "edison",
      behaviorId: "monthly",
    });
    expect(result.bill).toMatchObject({
      payee: "Southern California Edison",
      payee_id: "payee-edison",
      category_id: "cat-utilities",
      amount: 64.2,
      due_date: "2026-05-29",
    });
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
  });

  it("resolves a pasted-text mapping sample without requiring an email id", async () => {
    mockDb.execute.mockResolvedValueOnce(rowResult([metadataProjectionRow({
      accounts: [],
      payees: [{ id: "payee-spectrum", name: "Spectrum" }],
      categories: [{ id: "cat-internet", name: "Internet" }],
    })]));

    const result = await resolveBillPaySample("u1", {
      mappings: {
        version: 1,
        profiles: [{
          id: "spectrum",
          enabled: true,
          identity: { aliases: ["spectrum"] },
          behaviors: [{
            id: "internet",
            enabled: true,
            type: "expense",
            intent: { body: ["internet statement"] },
            amountStrategy: "amount_due",
            targets: {
              payee_id: "payee-spectrum",
              payee_label: "Spectrum",
              category_id: "cat-internet",
              category_label: "Internet",
            },
          }],
        }],
      },
      email: {
        from: "billing@spectrum.net",
        subject: "Statement",
        body: "Spectrum internet statement. Amount due: $84.99",
      },
      candidate: { payee_hint: "Spectrum", due_date: "2026-06-01" },
    });

    expect(result.mapping).toMatchObject({
      status: "matched",
      profileId: "spectrum",
      behaviorId: "internet",
      amountSource: "amount_due",
    });
    expect(result.bill).toMatchObject({
      payee_id: "payee-spectrum",
      category_id: "cat-internet",
      amount: 84.99,
    });
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

describe("sendBill", () => {
  it("forwards to actual.sendBill and schedules a delayed mirror refresh", async () => {
    mockActual.sendBill.mockResolvedValueOnce({ id: "bill-1" });
    mockDb.execute.mockResolvedValueOnce(rowResult());
    const out = await sendBill("u1", { payee: "x", amount: 10, type: "bill" });
    expect(out).toEqual({ id: "bill-1" });
    expect(mockActual.sendBill).toHaveBeenCalledWith({ payee: "x", amount: 10, type: "bill" }, "u1");
    expect(mockDb.execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/ea_bills_mirror_state/i),
      args: expect.arrayContaining(["u1"]),
    }));
  });
});

describe("Bills mirror", () => {
  it("reads occurrence mirror rows with stable occurrence ids and sync health", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rowResult([
        {
          status: "current",
          actual_configured: 1,
          actual_budget_url: "https://actual.example.test",
          last_success_at: "2026-05-06T12:00:00.000Z",
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: null,
          pending_refresh_at: null,
          refresh_started_at: null,
        },
      ]))
      .mockResolvedValueOnce(rowResult([
        {
          occurrence_id: "sched-1:2026-05-10",
          schedule_id: "sched-1",
          occurrence_date: "2026-05-10",
          name: "Mortgage",
          payee: "Mortgage Co",
          amount: 1500,
          type: "bill",
          paid: 0,
          open_action_disabled: 0,
        },
      ]));

    const out = await readBillsMirrorRange("u1", { start: "2026-05-01", end: "2026-05-31" });

    expect(out).toMatchObject({
      schedules: [
        {
          id: "sched-1:2026-05-10",
          scheduleId: "sched-1",
          next_date: "2026-05-10",
          paid: false,
          openActionDisabled: false,
        },
      ],
      recentTransactions: [],
      actualBudgetUrl: "https://actual.example.test",
      syncHealth: {
        state: "current",
        configured: true,
        lastSuccessAt: "2026-05-06T12:00:00.000Z",
      },
    });
  });

  it("returns empty mirror data with needs_sync health without reading Actual", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rowResult([]))
      .mockResolvedValueOnce(rowResult([]));

    const out = await readBillsMirrorRange("u1", { start: "2026-05-01", end: "2026-05-31" });

    expect(out.schedules).toEqual([]);
    expect(out.syncHealth).toMatchObject({ state: "needs_sync", configured: null });
    expect(mockActual.getCalendarBillsRange).not.toHaveBeenCalled();
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
  });

  it("full-replaces schedule and occurrence mirror rows on successful refresh", async () => {
    const actualMetadata = {
      accounts: [{ id: "acct-1", name: "Checking" }],
      payees: [{ id: "payee-1", name: "Mortgage Co" }],
      payeeMap: { "payee-1": "Mortgage Co" },
      categories: [{ group_name: "Home", categories: [{ id: "cat-1", name: "Mortgage" }] }],
      schedules: [
        {
          id: "sched-1",
          name: "Mortgage",
          next_date: "2026-05-10",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-1" },
            { field: "amount", value: -150000 },
          ],
        },
      ],
      recentTransactions: [],
    };
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(actualMetadata);
    mockDb.batch.mockResolvedValueOnce([]);
    mockDb.execute.mockResolvedValueOnce(rowResult());

    const out = await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledWith("u1", {
      refresh: false,
      localOnly: true,
    });
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    expect(mockActual.getCalendarBillsRange).not.toHaveBeenCalled();
    expect(mockDb.batch.mock.calls[0][0].map((entry) => entry.sql)).toEqual([
      expect.stringMatching(/INSERT INTO ea_bills_mirror_state/i),
      expect.stringMatching(/DELETE FROM ea_bill_occurrence_mirror/i),
      expect.stringMatching(/DELETE FROM ea_bill_schedule_mirror/i),
      expect.stringMatching(/INSERT INTO ea_actual_metadata_mirror/i),
      expect.stringMatching(/INSERT INTO ea_bill_schedule_mirror/i),
      expect.stringMatching(/INSERT INTO ea_bill_occurrence_mirror/i),
      expect.stringMatching(/UPDATE ea_bills_mirror_state/i),
    ]);
    expect(out.syncHealth).toMatchObject({ state: "current", configured: true });
    expect(out.allSchedules).toEqual([
      expect.objectContaining({
        id: "sched-1:2026-05-10",
        scheduleId: "sched-1",
        payee: "Mortgage Co",
        amount: 1500,
      }),
    ]);
  });

  it("prefers the cached local Actual projection for mirror refreshes", async () => {
    const syncedMetadata = {
      accounts: [],
      payees: [{ id: "payee-water", name: "SGV Water" }],
      payeeMap: { "payee-water": "SGV Water" },
      categories: [],
      schedules: [
        {
          id: "water",
          name: "Water Bill",
          next_date: "2026-05-26",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-water" },
            { field: "amount", value: -5067 },
          ],
        },
      ],
      recentTransactions: [],
    };
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(syncedMetadata);
    mockDb.batch.mockResolvedValueOnce([]);

    const out = await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledWith("u1", {
      refresh: false,
      localOnly: true,
    });
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    expect(out.allSchedules).toEqual([
      expect.objectContaining({
        name: "Water Bill",
        next_date: "2026-05-26",
      }),
    ]);
  });

  it("hydrates the local Actual cache and refreshes the bills mirror from that cache", async () => {
    const actualMetadata = {
      accounts: [],
      payees: [{ id: "payee-power", name: "Power Co" }],
      payeeMap: { "payee-power": "Power Co" },
      categories: [],
      schedules: [
        {
          id: "power",
          name: "Power Bill",
          next_date: "2026-05-10",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-power" },
            { field: "amount", value: -12234 },
          ],
        },
      ],
      recentTransactions: [],
    };
    mockDb.execute.mockResolvedValueOnce(rowResult([{ actual_budget_url: "https://actual.example.test" }]));
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(actualMetadata);
    mockDb.batch.mockResolvedValueOnce([]);

    const out = await hydrateActualCache("u1", {
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockActualLocal.hydrateLocalActualCache).toHaveBeenCalledWith("u1", { dbClient: mockDb });
    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledWith("u1", {
      refresh: false,
      localOnly: true,
    });
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      success: true,
      hydrated: true,
      budgetId: "Budget-1",
      billsCount: 1,
      schedulesCount: 1,
      syncHealth: { state: "current", configured: true },
    });
  });

  it("returns old mirror rows with degraded health when lightweight refresh fails without spawning the Actual worker", async () => {
    mockActualLocal.readLocalActualMetadata
      .mockRejectedValueOnce(new Error("Actual local file unavailable"))
      .mockRejectedValueOnce(new Error("Actual download timed out"));
    mockDb.execute
      .mockResolvedValueOnce(rowResult())
      .mockResolvedValueOnce(rowResult([
        {
          status: "degraded",
          actual_configured: 1,
          actual_budget_url: "https://actual.example.test",
          last_success_at: "2026-05-05T12:00:00.000Z",
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: "Actual download timed out",
          pending_refresh_at: null,
          refresh_started_at: null,
        },
      ]))
      .mockResolvedValueOnce(rowResult([
        {
          occurrence_id: "sched-1:2026-05-10",
          schedule_id: "sched-1",
          occurrence_date: "2026-05-10",
          name: "Mortgage",
          payee: "Mortgage Co",
          amount: 1500,
          type: "bill",
          paid: 0,
          open_action_disabled: 0,
        },
      ]));

    const out = await refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockActual.getCalendarBillsRange).not.toHaveBeenCalled();
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenNthCalledWith(1, "u1", {
      refresh: false,
      localOnly: true,
    });
    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenNthCalledWith(2, "u1", { refresh: true });
    expect(mockDb.batch).not.toHaveBeenCalled();
    expect(mockDb.execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/ea_bills_mirror_state/i),
    }));
    expect(out.billsSyncHealth).toMatchObject({
      state: "degraded",
      lastError: "Actual download timed out",
    });
    expect(out.allSchedules).toEqual([
      expect.objectContaining({
        id: "sched-1:2026-05-10",
        payee: "Mortgage Co",
      }),
    ]);
  });

  it("coalesces concurrent mirror refreshes for the same user", async () => {
    const actualMetadata = {
      accounts: [],
      payees: [{ id: "payee-1", name: "Mortgage Co" }],
      payeeMap: { "payee-1": "Mortgage Co" },
      categories: [],
      schedules: [
        {
          id: "sched-1",
          name: "Mortgage",
          next_date: "2026-05-10",
          type: "bill",
          conditions: [
            { field: "payee", value: "payee-1" },
            { field: "amount", value: -150000 },
          ],
        },
      ],
      recentTransactions: [],
    };
    let finishBatch;
    mockActualLocal.readLocalActualMetadata.mockResolvedValueOnce(actualMetadata);
    mockDb.batch.mockReturnValueOnce(new Promise((resolve) => {
      finishBatch = () => resolve([]);
    }));

    const first = refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });
    const second = refreshBillsMirror("u1", {
      actualBudgetUrl: "https://actual.example.test",
      now: new Date("2026-05-06T12:00:00.000Z"),
    });
    await Promise.resolve();

    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenCalledTimes(1);
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
    finishBatch();

    const [firstOut, secondOut] = await Promise.all([first, second]);
    expect(firstOut.allSchedules).toEqual(secondOut.allSchedules);
    expect(mockDb.batch).toHaveBeenCalledTimes(1);
  });

  it("schedules and consumes server-owned delayed refreshes", async () => {
    mockDb.execute.mockResolvedValueOnce(rowResult());
    await scheduleBillsMirrorRefresh("u1", {
      delayMs: 60_000,
      now: new Date("2026-05-06T12:00:00.000Z"),
    });

    expect(mockDb.execute).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(["2026-05-06T12:01:00.000Z"]),
    }));

    mockDb.execute.mockReset();
    mockDb.execute
      .mockResolvedValueOnce(rowResult([{ pending_refresh_at: "2026-05-06T12:01:00.000Z" }]))
      .mockResolvedValueOnce(rowResult());
    const due = await consumeDueBillsMirrorRefresh("u1", {
      now: new Date("2026-05-06T12:01:01.000Z"),
    });

    expect(due).toBe(true);
    expect(mockDb.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/pending_refresh_at = NULL/i),
    }));
  });

  it("flags maintenance due only for old successful configured mirrors", () => {
    const now = new Date("2026-05-06T18:01:00.000Z");

    expect(isBillsMirrorMaintenanceDue({
      state: "current",
      configured: true,
      lastSuccessAt: "2026-05-06T12:00:00.000Z",
      pendingRefreshAt: null,
      refreshStartedAt: null,
    }, { now })).toBe(true);

    expect(isBillsMirrorMaintenanceDue({
      state: "current",
      configured: true,
      lastSuccessAt: "2026-05-06T12:02:00.000Z",
    }, { now })).toBe(false);

    expect(isBillsMirrorMaintenanceDue({
      state: "needs_sync",
      configured: true,
      lastSuccessAt: "2026-05-06T11:00:00.000Z",
    }, { now })).toBe(false);
  });

  it("backs off degraded mirror maintenance after a recent failed attempt", () => {
    const now = new Date("2026-05-06T18:01:00.000Z");

    expect(isBillsMirrorMaintenanceDue({
      state: "degraded",
      configured: true,
      lastSuccessAt: "2026-05-06T12:00:00.000Z",
      lastAttemptAt: "2026-05-06T17:55:00.000Z",
    }, { now })).toBe(false);
  });
});

describe("listAccounts", () => {
  it("reads from the projected Actual metadata mirror", async () => {
    mockDb.execute.mockResolvedValueOnce(rowResult([
      {
        status: "current",
        accounts_json: JSON.stringify([{ id: "a1" }]),
        payees_json: "[]",
        categories_json: "[]",
        schedules_json: "[]",
        recent_transactions_json: "[]",
        last_success_at: "2026-05-06T12:00:00.000Z",
        last_attempt_at: "2026-05-06T12:00:00.000Z",
        last_error: null,
      },
    ]));
    const out = await listAccounts("u1");
    expect(out).toEqual([{ id: "a1" }]);
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
  });

  it("does not spawn Actual for empty degraded metadata on render-facing reads", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rowResult([
        {
          status: "degraded",
          accounts_json: "[]",
          payees_json: "[]",
          categories_json: "[]",
          schedules_json: "[]",
          recent_transactions_json: "[]",
          last_success_at: null,
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: "Actual worker exited",
        },
      ]));

    await expect(listAccounts("u1")).rejects.toMatchObject({
      status: 503,
      message: /Actual metadata projection is unavailable/,
    });
    expect(mockActual.getMetadata).not.toHaveBeenCalled();
  });

  it("can explicitly refresh empty metadata projections through the worker after lightweight projection fails", async () => {
    mockDb.execute
      .mockResolvedValueOnce(rowResult([
        {
          status: "needs_sync",
          accounts_json: "[]",
          payees_json: "[]",
          categories_json: "[]",
          schedules_json: "[]",
          recent_transactions_json: "[]",
          last_success_at: null,
          last_attempt_at: "2026-05-06T12:00:00.000Z",
          last_error: "Actual worker exited",
        },
      ]))
      .mockResolvedValueOnce(rowResult());
    mockActual.getMetadata.mockResolvedValueOnce({
      accounts: [{ id: "a1", name: "Checking" }],
      payees: [],
      categories: [],
    });

    const out = await getMetadata("u1", { allowRefresh: true });

    expect(out.accounts).toEqual([{ id: "a1", name: "Checking" }]);
    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenNthCalledWith(1, "u1", {
      refresh: false,
      localOnly: true,
    });
    expect(mockActualLocal.readLocalActualMetadata).toHaveBeenNthCalledWith(2, "u1", { refresh: true });
    expect(mockActual.getMetadata).toHaveBeenCalledWith("u1", { forceWorker: true, forceRefresh: true });
    expect(mockDb.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      sql: expect.stringMatching(/INSERT INTO ea_actual_metadata_mirror/i),
    }));
  });
});
