import { afterEach, describe, expect, it, vi } from "vitest";

describe("demo financial activity transport", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
  it("opens exact records and reflects in-memory import completion without a provider", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    vi.stubGlobal("fetch", () => { throw new Error("Demo must not reach the network"); });
    const api = await import("./api");
    const before = await api.listFinancialActivity({ view: "needs_attention", source: "paypal" });
    const pending = before.items[0]!;
    expect(pending.reference.owner).toBe("import");
    expect(await api.getFinancialActivity(pending.reference)).toMatchObject({ id: pending.id, status: "needs_attention" });
    if (pending.reference.owner !== "import") throw new Error("Expected the fictional import record");
    await api.commitTransactionImportItems(pending.reference.runId, [{ itemId: pending.reference.id }]);
    expect(await api.getFinancialActivity(pending.reference)).toMatchObject({ id: pending.id, status: "completed" });
    expect((await api.listFinancialActivity({ view: "needs_attention", source: "paypal" })).total).toBe(before.total - 1);
    expect(await api.inspectFinancialActivityBinding(pending.reference, "demo-budget")).toEqual({ status: "unavailable", evidence: null });
    const managed = await api.listFinancialActivity({ source: "managed" });
    expect(new Set(managed.items.map((item) => item.status))).toEqual(new Set(["completed", "processing", "needs_attention"]));
  });
});
