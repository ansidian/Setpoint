import { afterEach, describe, expect, it, vi } from "vitest";

async function importApi() {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", "");
  return import("./api");
}

function okJson(body: unknown, status = 200): Response {
  return { ok: true, status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

describe("transaction import API helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("sends typed scan, correction, and email-status requests", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(okJson({ runId: "run-1", created: true }, 202))
      .mockResolvedValueOnce(okJson({ accepted: 1 }, 202))
      .mockResolvedValueOnce(okJson({ emailUid: "gmail-1", items: [] }));
    vi.stubGlobal("fetch", fetch);
    const api = await importApi();

    await api.startTransactionImportScan({
      gmailAccountIds: ["gmail-1"],
      sources: ["amazon"],
      startDate: "2026-07-01",
      endDate: "2026-07-22",
    });
    await api.commitTransactionImportItems("run-1", [{
      itemId: "item-1",
      payee: "Corrected merchant",
      amountCents: -1299,
    }]);
    await api.getTransactionImportEmailStatus("gmail-1/message 1");

    // test-architecture: allow-boundary-interaction -- Transaction-import fetch is an irreversible HTTP boundary; the encoded route and write payload are the stable wire contract.
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/briefing/transaction-imports/runs");
    // test-architecture: allow-boundary-interaction -- Transaction-import fetch is an irreversible HTTP boundary; the encoded route and write payload are the stable wire contract.
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/briefing/transaction-imports/runs/run-1/commit");
    // test-architecture: allow-boundary-interaction -- Transaction-import fetch is an irreversible HTTP boundary; the encoded route and write payload are the stable wire contract.
    expect(fetch.mock.calls[2]?.[0]).toBe("/api/briefing/transaction-imports/email-status?emailUid=gmail-1%2Fmessage%201");
  });
});
