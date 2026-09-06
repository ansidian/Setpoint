import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinancialReviewNotifications } from "./financialReviewNotifications";
import { getFinancialEventReview, getFinancialReviewChanges } from "./financialReviewApi";
import type { FinancialReviewChangesResponse } from "../../shared/types/financial-review";

const storageKey = "ea_financial_review_notifications_v1";
const notices: FakeNotification[] = [];
class FakeNotification {
  static permission: NotificationPermission = "granted";
  static fail = false;
  onclick: (() => void) | null = null;
  closed = false;
  title: string;
  options: NotificationOptions;
  constructor(title: string, options: NotificationOptions) {
    if (FakeNotification.fail) throw new Error("Notification unavailable");
    this.title = title; this.options = options;
    notices.push(this);
  }
  close() { this.closed = true; }
}
const batch = (key = "missing-account", at = 100_000): FinancialReviewChangesResponse => ({
  items: [{ key, emailUid: "gmail-1/message 1" }], cursor: { updatedAt: at, id: "event:1" }, hasMore: false,
});
function respond(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }

describe("financial review browser delivery", () => {
  beforeEach(() => {
    localStorage.clear(); notices.length = 0;
    FakeNotification.permission = "granted"; FakeNotification.fail = false;
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubEnv("VITE_EA_DEMO", "");
    vi.spyOn(window, "focus").mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); localStorage.clear(); });

  it("opens a single record directly and keeps unchanged retries quiet across reloads", async () => {
    let response = batch();
    vi.stubGlobal("fetch", async () => respond(response));
    const controller = createFinancialReviewNotifications((href) => window.history.replaceState(null, "", href));
    await controller.refresh();
    expect(notices.map((notice) => notice.title)).toEqual(["A financial record needs your attention"]);
    notices[0]!.onclick?.();
    expect(window.location.search).toBe("?tab=finance&financialEmail=gmail-1%2Fmessage%201");
    expect(window.location.hash).toBe("#financial-event-review");
    expect(notices[0]!.closed).toBe(true);
    response = batch("missing-account", 1_000_000);
    await controller.refresh();
    controller.dispose();
    const reopened = createFinancialReviewNotifications(() => {});
    await reopened.refresh();
    expect(notices).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(storageKey)!).cursor.updatedAt).toBe(1_000_000);
    reopened.dispose();
  });

  it("drains past the first page, groups new items, and delivers a later action on an old record", async () => {
    const responses = [
      { ...batch(), hasMore: true },
      { ...batch("second-record", 100_001), items: [{ key: "second-record", emailUid: "gmail-2/archived" }] },
    ];
    vi.stubGlobal("fetch", async () => respond(responses.shift() || batch("check-actual", 1_000_000)));
    const controller = createFinancialReviewNotifications((href) => window.history.replaceState(null, "", href));
    await controller.refresh();
    expect(notices[0]!.title).toBe("2 financial records need your attention");
    notices[0]!.onclick?.();
    expect(window.location.search).toBe("?tab=finance");
    await controller.refresh();
    expect(notices).toHaveLength(2);
    controller.dispose();
  });

  it("advances over silent processing states without delivering a notification", async () => {
    vi.stubGlobal("fetch", async () => respond({ ...batch(), items: [] }));
    const controller = createFinancialReviewNotifications(() => {});
    await controller.refresh();
    expect(notices).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ cursor: batch().cursor, keys: [] });
    controller.dispose();
  });

  it("does not consume changes without permission, after a failed read, or when delivery fails", async () => {
    let failedRead = false;
    vi.stubGlobal("fetch", async () => {
      if (failedRead) throw new Error("Offline");
      return respond(batch());
    });
    const controller = createFinancialReviewNotifications(() => {});
    FakeNotification.permission = "default";
    await controller.refresh();
    expect(localStorage.getItem(storageKey)).toBeNull();
    FakeNotification.permission = "granted"; failedRead = true;
    await controller.refresh();
    expect(localStorage.getItem(storageKey)).toBeNull();
    failedRead = false; FakeNotification.fail = true;
    await controller.refresh();
    expect(localStorage.getItem(storageKey)).toBeNull();
    FakeNotification.fail = false;
    await controller.refresh();
    expect(notices).toHaveLength(1);
    controller.dispose();
  });

  it("ignores a completed request after leaving the authenticated app", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { finish = resolve; }));
    const controller = createFinancialReviewNotifications(() => {});
    const read = controller.refresh();
    controller.dispose();
    finish(respond(batch()));
    await read;
    expect(notices).toHaveLength(0);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("continues a large backlog in bounded batches without repeating already delivered keys", async () => {
    vi.useFakeTimers();
    let index = 0;
    vi.stubGlobal("fetch", async () => respond({ ...batch(`record-${++index}`, 100_000 + index), hasMore: index < 7 }));
    const controller = createFinancialReviewNotifications(() => {});
    await controller.refresh();
    expect(notices.map((notice) => notice.title)).toEqual(["5 financial records need your attention"]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(notices.map((notice) => notice.title)).toEqual(["5 financial records need your attention", "2 financial records need your attention"]);
    controller.dispose();
  });

  it("keeps demo reads and delivery entirely in memory without browser permission or storage", async () => {
    vi.stubEnv("VITE_EA_DEMO", "1");
    vi.stubGlobal("fetch", async () => { throw new Error("Demo must not reach the network"); });
    const controller = createFinancialReviewNotifications(() => {});
    await controller.refresh();
    expect(await getFinancialEventReview()).toEqual({ items: [], total: 0, offset: 0, limit: 20 });
    expect(await getFinancialReviewChanges(null)).toEqual({ items: [], cursor: null, hasMore: false });
    expect(notices).toHaveLength(0);
    expect(localStorage.getItem(storageKey)).toBeNull();
    controller.dispose();
  });
});
