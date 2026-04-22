import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = { execute: vi.fn() };

vi.mock("../db/connection.js", () => ({ default: mockDb }));
vi.mock("./encryption.js", () => ({
  decrypt: (value) => value,
  encrypt: (value) => value,
}));

vi.stubGlobal("fetch", vi.fn());

const { handleCallback } = await import("./gmail.js");

describe("gmail callback canonicalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses the canonical Gmail row when the same email is re-authorized", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "tok",
          refresh_token: "rtok",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.modify",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ emailAddress: "User@example.com" }),
      });

    mockDb.execute
      .mockResolvedValueOnce({
        rows: [
          {
            id: "gmail-fresh",
            type: "gmail",
            email: "user@example.com",
            label: "Work",
            sort_order: 2,
            updated_at: "2026-04-20T10:00:00Z",
          },
          {
            id: "gmail-old",
            type: "gmail",
            email: "USER@example.com",
            label: "Work old",
            sort_order: 7,
            updated_at: "2026-04-18T10:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    const result = await handleCallback("auth-code", "ignored", "user-1");

    expect(result.accountId).toBe("gmail-fresh");
    const insertCall = mockDb.execute.mock.calls.find(([call]) => call.sql.includes("INSERT INTO ea_accounts"));
    expect(insertCall[0].args[0]).toBe("gmail-fresh");
  });
});
