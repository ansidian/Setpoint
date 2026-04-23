import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

const mockDb = { execute: vi.fn() };

vi.mock("../db/connection.js", () => ({ default: mockDb }));

const { createSession, validateSession, deleteSession } = await import("./auth.js");

describe("auth middleware session storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores hashed session tokens and returns the raw cookie value", async () => {
    vi.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.alloc(32, 1));
    mockDb.execute.mockResolvedValue({});

    const rawToken = await createSession();

    const expectedRaw = Buffer.alloc(32, 1).toString("hex");
    const expectedStored = `sha256:${crypto.createHash("sha256").update(expectedRaw).digest("hex")}`;
    expect(rawToken).toBe(expectedRaw);
    expect(mockDb.execute).toHaveBeenCalledWith({
      sql: "INSERT INTO ea_sessions (token, expires_at) VALUES (?, ?)",
      args: [expectedStored, expect.any(Number)],
    });
  });

  it("validates hashed session rows", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ expires_at: Date.now() + 60_000 }],
    });

    const ok = await validateSession("cookie-session");

    expect(ok).toBe(true);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.execute.mock.calls[0][0].args[0]).toMatch(/^sha256:/);
  });

  it("accepts legacy raw session rows and migrates them to hashed storage", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ expires_at: Date.now() + 60_000 }] })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    const ok = await validateSession("legacy-session");

    expect(ok).toBe(true);
    expect(mockDb.execute).toHaveBeenNthCalledWith(2, {
      sql: "SELECT expires_at FROM ea_sessions WHERE token = ?",
      args: ["legacy-session"],
    });
    expect(mockDb.execute).toHaveBeenNthCalledWith(3, {
      sql: "UPDATE ea_sessions SET token = ? WHERE token = ?",
      args: [
        `sha256:${crypto.createHash("sha256").update("legacy-session").digest("hex")}`,
        "legacy-session",
      ],
    });
  });

  it("deletes both raw and hashed token forms on logout", async () => {
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });

    await deleteSession("logout-session");

    expect(mockDb.execute).toHaveBeenCalledWith({
      sql: "DELETE FROM ea_sessions WHERE token IN (?, ?)",
      args: [
        "logout-session",
        `sha256:${crypto.createHash("sha256").update("logout-session").digest("hex")}`,
      ],
    });
  });
});
