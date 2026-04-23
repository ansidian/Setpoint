import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
const gmailFetchEmails = vi.fn();
const icloudFetchEmails = vi.fn();
const isGmailMessageRead = vi.fn();
const isIcloudMessageRead = vi.fn();

vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("../middleware/auth.js", () => ({ requireCookieSession: (_req, _res, next) => next() }));
vi.mock("../briefing/encryption.js", () => ({ decrypt: (v) => v }));
vi.mock("../briefing/gmail.js", () => ({
  fetchEmails: (...a) => gmailFetchEmails(...a),
  isMessageRead: (...a) => isGmailMessageRead(...a),
}));
vi.mock("../briefing/icloud.js", () => ({
  fetchEmails: (...a) => icloudFetchEmails(...a),
  isMessageRead: (...a) => isIcloudMessageRead(...a),
}));
vi.mock("../briefing/calendar.js", () => ({
  fetchCalendar: async () => [],
  getNextWeekRange: () => [0, 0],
  getTomorrowRange: () => [0, 0],
}));
vi.mock("../briefing/weather.js", () => ({
  fetchWeather: async () => ({ temp: 0, high: 0, low: 0, summary: "", hourly: [] }),
}));
vi.mock("../briefing/actual.js", () => ({
  getUpcomingBills: async () => [],
  getRecentTransactions: async () => [],
  getMetadata: async () => ({ schedules: [], payeeMap: {}, recentTransactions: [] }),
  isSchedulePaid: () => false,
}));
vi.mock("../briefing/index.js", () => ({
  loadUserConfig: async () => ({
    accounts: [
      { id: "gmail-a", type: "gmail", label: "Work", email: "w@e.com", credentials_encrypted: "{}" },
    ],
    settings: { weather_location: "X", important_senders_json: "[]" },
  }),
}));

process.env.EA_USER_ID = "u1";

const { default: router } = await import("./live.js");

function findHandler(method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  return layer?.route?.stack.slice(-1)[0]?.handle;
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function stubDbDefault({ briefingJson, generatedAt }) {
  mockDb.execute.mockImplementation(async ({ sql }) => {
    if (sql.includes("FROM ea_briefings") && sql.includes("ORDER BY generated_at DESC LIMIT 1")) {
      return generatedAt ? { rows: [{ id: 1, briefing_json: briefingJson, generated_at: generatedAt }] } : { rows: [] };
    }
    // pinned / snoozed / resurfaced / senders
    return { rows: [] };
  });
}

describe("GET /api/live/all — dynamic hoursBack", () => {
  beforeEach(() => {
    mockDb.execute.mockReset();
    gmailFetchEmails.mockReset().mockResolvedValue([]);
    icloudFetchEmails.mockReset().mockResolvedValue([]);
    isGmailMessageRead.mockReset().mockResolvedValue(null);
    isIcloudMessageRead.mockReset().mockResolvedValue(null);
  });

  it("uses 12h default when the briefing has zero known email UIDs (empty-briefing guard)", async () => {
    // Briefing is 2h old, but empty — live must not shrink to 2h. A narrow
    // slice would hide older email that mark-as-unread / manual resurface
    // flows expect to see.
    const generatedAt = new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
    const emptyBriefing = JSON.stringify({ emails: { accounts: [{ important: [], noise: [] }] } });
    stubDbDefault({ briefingJson: emptyBriefing, generatedAt });

    const handler = findHandler("get", "/all");
    await handler({}, makeRes());

    expect(gmailFetchEmails).toHaveBeenCalledTimes(1);
    const passedHoursBack = gmailFetchEmails.mock.calls[0][1];
    expect(passedHoursBack).toBe(12);
  });

  it("shrinks to elapsed time when the briefing has emails covering the backlog", async () => {
    // Briefing 3h old (minus 1s to keep Math.ceil at 3) with an email in it —
    // live only needs to cover the 3h gap.
    const ms = 3 * 3600_000 - 1000;
    const generatedAt = new Date(Date.now() - ms).toISOString().slice(0, 19).replace("T", " ");
    const briefing = JSON.stringify({
      emails: { accounts: [{ important: [{ id: "x1", uid: "u1" }], noise: [] }] },
    });
    stubDbDefault({ briefingJson: briefing, generatedAt });

    const handler = findHandler("get", "/all");
    await handler({}, makeRes());

    const passedHoursBack = gmailFetchEmails.mock.calls[0][1];
    expect(passedHoursBack).toBe(3);
  });

  it("reconciles briefing Gmail read state even when the email is outside the live fetch window", async () => {
    const generatedAt = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
    const briefing = JSON.stringify({
      emails: {
        accounts: [{
          name: "Work",
          important: [{
            id: "gmail-gmail-a-msg-1",
            uid: "gmail-gmail-a-msg-1",
            account_id: "gmail-a",
            account_email: "w@e.com",
            read: false,
          }],
          noise: [],
        }],
      },
    });
    stubDbDefault({ briefingJson: briefing, generatedAt });
    isGmailMessageRead.mockResolvedValueOnce(true);

    const handler = findHandler("get", "/all");
    const res = makeRes();
    await handler({}, res);

    expect(res.body.briefingReadStatus).toEqual({ "gmail-gmail-a-msg-1": true });
  });

  it("preserves explicit false when provider says a briefing email is still unread", async () => {
    mockDb.execute.mockImplementation(async ({ sql }) => {
      if (sql.includes("FROM ea_briefings") && sql.includes("ORDER BY generated_at DESC LIMIT 1")) {
        return {
          rows: [{
            id: 1,
            generated_at: new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 19).replace("T", " "),
            briefing_json: JSON.stringify({
              emails: {
                accounts: [{
                  name: "Work",
                  important: [{
                    id: "gmail-gmail-a-msg-2",
                    uid: "gmail-gmail-a-msg-2",
                    account_id: "gmail-a",
                    account_email: "w@e.com",
                    read: true,
                  }],
                  noise: [],
                }],
              },
            }),
          }],
        };
      }
      return { rows: [] };
    });
    isGmailMessageRead.mockResolvedValueOnce(false);

    const handler = findHandler("get", "/all");
    const res = makeRes();
    await handler({}, res);

    expect(Object.prototype.hasOwnProperty.call(res.body.briefingReadStatus, "gmail-gmail-a-msg-2")).toBe(true);
    expect(res.body.briefingReadStatus["gmail-gmail-a-msg-2"]).toBe(false);
  });

  it("falls back to indexed read state when provider probing cannot confirm the latest briefing row", async () => {
    const uid = "gmail-gmail-a-msg-3";
    mockDb.execute.mockImplementation(async ({ sql }) => {
      if (sql.includes("FROM ea_briefings") && sql.includes("ORDER BY generated_at DESC LIMIT 1")) {
        return {
          rows: [{
            id: 1,
            generated_at: new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 19).replace("T", " "),
            briefing_json: JSON.stringify({
              emails: {
                accounts: [{
                  name: "Work",
                  important: [{
                    id: uid,
                    uid,
                    account_id: "gmail-a",
                    account_email: "w@e.com",
                    read: false,
                  }],
                  noise: [],
                }],
              },
            }),
          }],
        };
      }
      if (sql.includes("FROM ea_email_index")) {
        return { rows: [{ uid, read: 1 }] };
      }
      return { rows: [] };
    });
    isGmailMessageRead.mockResolvedValueOnce(null);

    const handler = findHandler("get", "/all");
    const res = makeRes();
    await handler({}, res);

    expect(res.body.briefingReadStatus).toEqual({ [uid]: true });
  });

  it("reconciles briefing noise read state from provider/index data too", async () => {
    const uid = "gmail-gmail-a-noise-1";
    mockDb.execute.mockImplementation(async ({ sql }) => {
      if (sql.includes("FROM ea_briefings") && sql.includes("ORDER BY generated_at DESC LIMIT 1")) {
        return {
          rows: [{
            id: 1,
            generated_at: new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 19).replace("T", " "),
            briefing_json: JSON.stringify({
              emails: {
                accounts: [{
                  name: "Work",
                  important: [],
                  noise: [{
                    id: uid,
                    uid,
                    account_id: "gmail-a",
                    account_email: "w@e.com",
                    read: false,
                  }],
                }],
              },
            }),
          }],
        };
      }
      if (sql.includes("FROM ea_email_index")) {
        return { rows: [{ uid, read: 1 }] };
      }
      return { rows: [] };
    });
    isGmailMessageRead.mockResolvedValueOnce(null);

    const handler = findHandler("get", "/all");
    const res = makeRes();
    await handler({}, res);

    expect(res.body.briefingReadStatus).toEqual({ [uid]: true });
  });
});
