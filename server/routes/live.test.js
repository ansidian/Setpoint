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

describe("GET /api/live/all", () => {
  beforeEach(() => {
    mockDb.execute.mockReset();
    gmailFetchEmails.mockReset().mockResolvedValue([]);
    icloudFetchEmails.mockReset().mockResolvedValue([]);
    isGmailMessageRead.mockReset().mockResolvedValue(null);
    isIcloudMessageRead.mockReset().mockResolvedValue(null);
  });

  it("uses the fixed active email window without reading legacy briefing rows", async () => {
    mockDb.execute.mockImplementation(async ({ sql }) => {
      if (sql.includes("ea_briefings")) {
        throw new Error("live route must not read legacy briefings");
      }
      return { rows: [] };
    });

    const handler = findHandler("get", "/all");
    const res = makeRes();
    await handler({}, res);

    expect(gmailFetchEmails).toHaveBeenCalledTimes(1);
    expect(gmailFetchEmails.mock.calls[0][1]).toBe(12);
    expect(res.body.briefingGeneratedAt).toBeNull();
    expect(res.body.briefingReadStatus).toEqual({});
    expect(mockDb.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ sql: expect.stringMatching(/ea_briefings/i) }),
    );
  });

  it("does not strip bill flags by mutating legacy briefing JSON", async () => {
    mockDb.execute.mockImplementation(async ({ sql }) => {
      if (/UPDATE\s+ea_briefings/i.test(sql)) {
        throw new Error("live route must not mutate legacy briefings");
      }
      return { rows: [] };
    });

    const handler = findHandler("get", "/all");
    const res = makeRes();
    await handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(mockDb.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ sql: expect.stringMatching(/UPDATE\s+ea_briefings/i) }),
    );
  });
});
