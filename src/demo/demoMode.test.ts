import { afterEach, describe, expect, it, vi } from "vitest";

async function importApiWithDemoMode(value: string) {
  vi.resetModules();
  vi.stubEnv("VITE_EA_DEMO", value);
  return import("../api");
}

function installRecordingFetch(payload: unknown, status = 200) {
  const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push([input, init]);
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(payload) } as Response);
  });
  return requests;
}

describe("demo mode API network guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps auth local and blocks API fetches before network in demo mode", async () => {
    let networkAttempted = false;
    let beaconAttempted = false;
    vi.stubGlobal("fetch", () => { networkAttempted = true; throw new Error("Demo mode reached fetch"); });
    vi.stubGlobal("navigator", { sendBeacon: () => { beaconAttempted = true; return true; } });

    const api = await importApiWithDemoMode("1");

    await expect(api.checkAuth()).resolves.toEqual({ authenticated: true, demo: true });
    await expect(api.login("anything")).resolves.toEqual({ authenticated: true, demo: true });
    await expect(api.getCurrentDashboard()).resolves.toMatchObject({ fetchedAt: expect.any(String) });
    await expect(api.settleArrivalGrace()).rejects.toMatchObject({
      code: "DEMO_API_UNHANDLED",
    });

    api.settleArrivalGraceOnExit();

    expect(networkAttempted).toBe(false);
    expect(beaconAttempted).toBe(false);
  });

  it("refreshes Dashboard after an email is handled even when the demo timestamp stays fixed", async () => {
    const requests = installRecordingFetch({});
    const api = await importApiWithDemoMode("1");
    const { renderHook, act, waitFor } = await import("@testing-library/react/pure");
    const { default: useCurrentDashboard } = await import("../hooks/useCurrentDashboard");
    const { result, unmount } = renderHook(() => useCurrentDashboard());
    try {
      await waitFor(() => expect(result.current.current).toBeTruthy());
      const before = result.current.current!;
      const email = before.activeSnapshot.carryover[0]!;
      await act(async () => {
        await api.markSnapshotItemHandled(email.id);
        await result.current.activeSnapshot.refresh();
      });
      expect(result.current.current!.fetchedAt).toBe(before.fetchedAt);
      expect(result.current.current!.activeSnapshot.carryover.some(row => row.id === email.id)).toBe(false);
      expect(result.current.current!.activeSnapshot.lanes.handled.some(row => row.id === email.id)).toBe(true);
      expect(requests).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("previews and confirms fictional corrections without network and preserves receipts", async () => {
    const requests = installRecordingFetch({});
    const api = await importApiWithDemoMode("1");
    const reference = { owner: "event" as const, id: "demo-event-transfer" };
    const draft = { type: "transfer" as const, amountCents: 30000, date: "2026-09-06", fromAccountId: "demo-checking", toAccountId: "demo-savings" };
    const before = await api.getFinancialActivity(reference);
    const preview = await api.previewFinancialCorrection(reference, draft);
    expect(preview.steps[0]?.after.transactions?.map(row => row.amount)).toEqual([-30000, 30000]);
    const result = await api.confirmFinancialCorrection(preview.id, "demo-key");
    expect(result.state).toBe("completed");
    expect(await api.getFinancialCorrection(result.id)).toEqual(result);
    expect(await api.confirmFinancialCorrection(preview.id, "demo-key")).toEqual(result);
    const after = await api.getFinancialActivity(reference);
    expect(after.originalReceipts).toEqual(before.originalReceipts);
    expect(after.effectiveResult).toMatchObject({ entry: draft });
    expect(requests).toEqual([]);
  });

  it("retains a fictional draft across stale previews and requires explicit schedule treatment", async () => {
    const requests = installRecordingFetch({});
    const api = await importApiWithDemoMode("1");
    const reference = { owner: "event" as const, id: "demo-event-schedule" };
    const draft = { type: "payment" as const, amountCents: 8200, date: "2026-09-06", accountId: "demo-checking" };
    await expect(api.previewFinancialCorrection(reference, draft)).rejects.toThrow("Choose what happens");
    const first = await api.previewFinancialCorrection(reference, { ...draft, scheduleTreatment: "keep" });
    const second = await api.previewFinancialCorrection(reference, { ...draft, scheduleTreatment: "keep", amountCents: 8300 });
    await api.confirmFinancialCorrection(second.id, "second");
    await expect(api.confirmFinancialCorrection(first.id, "first")).rejects.toMatchObject({ status: 409 });
    expect(first.draft.amountCents).toBe(8200);
    expect(requests).toEqual([]);
  });

  it("completes a managed fictional review through its owner and rejects repeated completion", async () => {
    const requests = installRecordingFetch({});
    const api = await importApiWithDemoMode("1");
    const reference = { owner: "event" as const, id: "demo-event-review" };
    const before = await api.getFinancialActivity(reference);
    expect(before.actions.complete).toBe(true);
    const request = { emailUid: "demo-email-budget", documentRevision: 1, eventRevision: 1,
      entry: { kind: "expense" as const, amount: 46.75, date: "2026-09-06", accountId: "demo-checking", payee: "Fictional Market" } };
    const plan = await api.completeFinancialEvent(request);
    expect(plan.workflow?.state).toBe("settled");
    expect((await api.getFinancialActivity(reference)).status).toBe("completed");
    await expect(api.completeFinancialEvent(request)).rejects.toMatchObject({ status: 409 });
    expect(requests).toEqual([]);
  });

  it("exposes fictional raw schedule state and distinguishes a stopped note failure from uncertain recovery", async () => {
    const requests = installRecordingFetch({});
    const api = await importApiWithDemoMode("1");
    const schedule = await api.inspectFinancialCorrection({ owner: "event", id: "demo-event-schedule" });
    expect(schedule.snapshot.rules[0]).toMatchObject({ conditions: expect.arrayContaining([{ field: "account", op: "is", value: "demo-checking" }]) });
    expect(schedule.snapshot.dates[0]?.base_next_date).toEqual(expect.any(Number));
    const transfer = await api.inspectFinancialCorrection({ owner: "event", id: "demo-event-transfer" });
    expect(transfer.snapshot.transactions.map(row => row.acct)).toEqual(["demo-checking", "demo-savings"]);
    await expect(api.previewFinancialCorrection(schedule.reference, { type: "payment", amountCents: 8200, date: "2026-09-06", accountId: "demo-checking", scheduleTreatment: "retire" })).rejects.toThrow("creation is not proven");
    const partial = await api.inspectFinancialCorrection({ owner: "event", id: "demo-event-partial" });
    expect(partial.correction).toMatchObject({ state: "attention", executionStopped: true, steps: [{ state: "applied" }, { state: "no_write" }] });
    const successor = await api.previewFinancialCorrection(partial.reference, partial.correction!.preview.draft);
    expect(successor.predecessorId).toBe(partial.correction?.id);
    expect(successor.snapshot.rules[0]).toMatchObject({ conditions: expect.arrayContaining([{ field: "amount", op: "is", value: -9000 }]) });
    const recovering = await api.inspectFinancialCorrection({ owner: "event", id: "demo-event-uncertain" });
    expect(recovering.correction).toMatchObject({ state: "recovering", executionStopped: false });
    const attention = await api.listFinancialActivity({ view: "needs_attention" });
    expect(attention.items.some(item => item.reference.id === "demo-event-uncertain")).toBe(true);
    expect(attention.items.some(item => item.reference.id === "demo-event-pending")).toBe(true);
    expect(attention.attentionTotal).toBe(attention.items.filter(item => item.status === "needs_attention").length);
    expect(attention.items.some(item => item.reference.id === "demo-event-partial")).toBe(true);
    expect(attention.total).toBe(attention.items.length);
    expect(await api.getFinancialActivity(recovering.reference)).toMatchObject({ status: "processing", actions: { complete: false, retry: false, correct: false } });
    await expect(api.previewFinancialCorrection(recovering.reference, recovering.correction!.preview.draft)).rejects.toThrow("remains uncertain");
    expect(requests).toEqual([]);
  });

  it("keeps utility sources immutable and links only recorded recurring payments", async () => {
    installRecordingFetch({});
    const api = await importApiWithDemoMode("1");
    const before = await api.getFinances();
    const original = before.utilities.find(row => row.identity.id === 'electricity')!.statements[0]!;
    const body = await api.getEmailBody(original.emailUid);
    const activity = await api.getFinancialActivity(original.activity!);
    expect(activity.emailUids).toContain(original.emailUid);
    expect(Date.parse(original.receivedAt)).toBeLessThanOrEqual(Date.now());
    const preview = await api.previewFinancialCorrection({owner:'event',id:'demo-event-schedule'}, {type:'bill',amountCents:12345,date:before.end,accountId:'demo-checking'});
    await api.confirmFinancialCorrection(preview.id,'different-record');
    expect((await api.getFinances()).utilities.find(row=>row.identity.id==='electricity')!.statements[0]).toEqual(original);
    expect(await api.getEmailBody(original.emailUid)).toEqual(body);
    const internet = before.utilities.find(row=>row.identity.id==='internet')!;
    const paymentId=internet.occurrences[0]!.paymentTransactionIds![0]!;
    const journal=await api.getFinanceJournal(before.start,before.end,paymentId);
    expect(journal.transactions.find(row=>row.id===paymentId)).toMatchObject({amountCents:-7999});
    expect(before.recurring.filter(row=>row.paid).every(row=>row.paymentTransactionIds?.length)).toBe(true);
    const day=await api.getFinanceJournal(before.end,before.end);
    expect(day.relatives).toEqual([]);
    const payment = await api.previewFinancialCorrection({owner:'event',id:'demo-event-schedule'}, {type:'payment',amountCents:12345,date:before.end,accountId:'demo-checking',scheduleTreatment:'keep'});
    await api.confirmFinancialCorrection(payment.id,'keep-schedule');
    const linked = await api.getFinanceJournal(before.end,before.end);
    expect(linked.transactions.some(row=>row.scheduleId==='demo-shared-schedule'&&row.amountCents===-12345)).toBe(true);
  });
  it("links Dashboard managed review to shared records and keeps disconnected receipts readable", async () => {
    const requests = installRecordingFetch({});
    const api = await importApiWithDemoMode("1");
    const review = await api.listFinancialActivity({ source: "managed", view: "needs_attention" });
    expect(review.items.map(item => item.reference.id)).toEqual(expect.arrayContaining(["demo-event-review", "demo-event-partial"]));
    expect(review.items.some(item => item.reference.id === "demo-event-uncertain")).toBe(true);
    const reference = { owner: "event" as const, id: "demo-event-disconnected" };
    const saved = await api.getFinancialActivity(reference);
    expect(saved.status).toBe("completed");
    expect(saved.originalReceipts.length).toBeGreaterThan(0);
    await expect(api.inspectFinancialCorrection(reference)).rejects.toMatchObject({ status: 503, code: "ACTUAL_UNAVAILABLE" });
    expect((await api.getFinancialActivity(reference)).originalReceipts).toEqual(saved.originalReceipts);
    expect(requests).toEqual([]);
  });

  it("keeps normal API fetch behavior outside demo mode", async () => {
    const requests = installRecordingFetch({ authenticated: true });

    const api = await importApiWithDemoMode("");

    await expect(api.checkAuth()).resolves.toEqual({ authenticated: true });

    expect(requests).toEqual([["/api/auth/check", expect.objectContaining({
      headers: expect.objectContaining({ "X-Requested-With": "Setpoint" }),
    })]]);
  });

  it("routes passkey auth helpers through explicit auth endpoints", async () => {
    const requests = installRecordingFetch({ ok: true });

    const api = await importApiWithDemoMode("");

    await api.getPasskeyAuthenticationOptions();
    await api.verifyPasskeyAuthentication({ id: "credential-1" } as Parameters<typeof api.verifyPasskeyAuthentication>[0]);
    await api.cancelPasskeyAuthentication();

    expect(requests).toEqual([
      ["/api/auth/passkey/authentication/options", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-Requested-With": "Setpoint" }),
      })],
      ["/api/auth/passkey/authentication/verify", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ id: "credential-1" }),
      })],
      ["/api/auth/passkey/authentication/cancel", expect.objectContaining({
      method: "POST",
      })],
    ]);
  });

  it("routes passkey management helpers through explicit settings endpoints", async () => {
    const requests = installRecordingFetch({ ok: true });

    const api = await importApiWithDemoMode("");

    await api.listPasskeys();
    await api.getPasskeyRegistrationOptions("MacBook Touch ID");
    await api.verifyPasskeyRegistration({ id: "credential-1", label: "MacBook Touch ID" } as Parameters<typeof api.verifyPasskeyRegistration>[0]);
    await api.deletePasskeyCredential("credential-1");

    expect(requests).toEqual([
      ["/api/auth/passkeys", expect.objectContaining({
      headers: expect.objectContaining({ "X-Requested-With": "Setpoint" }),
      })],
      ["/api/auth/passkeys/registration/options", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ label: "MacBook Touch ID" }),
      })],
      ["/api/auth/passkeys/registration/verify", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ id: "credential-1", label: "MacBook Touch ID" }),
      })],
      ["/api/auth/passkeys/credential-1", expect.objectContaining({
      method: "DELETE",
      })],
    ]);
  });

  it("keeps passkey management unavailable in demo mode before network", async () => {
    let networkAttempted = false;
    vi.stubGlobal("fetch", () => { networkAttempted = true; throw new Error("Demo mode reached fetch"); });

    const api = await importApiWithDemoMode("1");

    await expect(api.listPasskeys()).rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });
    await expect(api.getPasskeyRegistrationOptions("MacBook Touch ID"))
      .rejects.toMatchObject({ code: "DEMO_API_UNHANDLED" });

    expect(networkAttempted).toBe(false);
  });

  it("does not redirect the login page on passkey verification 401 responses", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ message: "Passkey verification failed" }),
    });
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState({}, "", "/login");

    const api = await importApiWithDemoMode("");

    await expect(api.verifyPasskeyAuthentication({ id: "credential-1" } as Parameters<typeof api.verifyPasskeyAuthentication>[0]))
      .rejects.toThrow("Passkey verification failed");
    expect(window.location.pathname).toBe("/login");
  });

  it("does not redirect Settings on passkey registration 401 responses", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ message: "Passkey registration failed" }),
    });
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState({}, "", "/settings");

    const api = await importApiWithDemoMode("");

    await expect(api.verifyPasskeyRegistration({ id: "credential-1" } as Parameters<typeof api.verifyPasskeyRegistration>[0]))
      .rejects.toThrow("Passkey registration failed");
    expect(window.location.pathname).toBe("/settings");
  });
});
