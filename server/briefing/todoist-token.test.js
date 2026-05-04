import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

const testState = vi.hoisted(() => ({
  db: { current: null },
}));

vi.mock("../db/connection.js", () => ({
  default: {
    execute: (...args) => testState.db.current.execute(...args),
  },
}));
vi.mock("./encryption.js", () => ({
  encrypt: (value) => `enc:${value}`,
  decrypt: (value) => String(value).replace(/^enc:/, ""),
}));

const {
  getTodoistApiToken,
  storeTodoistOAuthTokenResponse,
} = await import("./todoist-token.js");

async function createTodoistTokenTestDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      todoist_api_token_encrypted TEXT,
      todoist_oauth_refresh_token_encrypted TEXT,
      todoist_oauth_access_token_expires_at TEXT,
      todoist_oauth_scope TEXT,
      todoist_oauth_token_type TEXT
    );
  `);
  return db;
}

async function seedSettings(fields) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_settings
            (user_id, todoist_api_token_encrypted, todoist_oauth_refresh_token_encrypted,
             todoist_oauth_access_token_expires_at, todoist_oauth_scope, todoist_oauth_token_type)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      fields.userId || "u1",
      fields.accessToken ? `enc:${fields.accessToken}` : null,
      fields.refreshToken ? `enc:${fields.refreshToken}` : null,
      fields.expiresAt || null,
      fields.scope || null,
      fields.tokenType || null,
    ],
  });
}

beforeEach(async () => {
  testState.db.current = await createTodoistTokenTestDb();
});

afterEach(async () => {
  await testState.db.current?.close?.();
  testState.db.current = null;
});

describe("getTodoistApiToken", () => {
  it("keeps existing personal-token settings working without OAuth metadata", async () => {
    await seedSettings({ accessToken: "personal-token" });

    const token = await getTodoistApiToken("u1", {
      dbClient: testState.db.current,
      fetchFn: vi.fn(),
      env: {},
    });

    expect(token).toBe("personal-token");
  });

  it("returns a fresh OAuth access token without refreshing", async () => {
    await seedSettings({
      accessToken: "fresh-access",
      refreshToken: "refresh-1",
      expiresAt: "2026-05-04T20:30:00.000Z",
    });
    const fetchFn = vi.fn();

    const token = await getTodoistApiToken("u1", {
      dbClient: testState.db.current,
      fetchFn,
      env: {
        TODOIST_CLIENT_ID: "client-id",
        TODOIST_CLIENT_SECRET: "client-secret",
      },
      now: new Date("2026-05-04T20:00:00.000Z"),
    });

    expect(token).toBe("fresh-access");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refreshes an expired OAuth token and stores rotated credentials", async () => {
    await seedSettings({
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      expiresAt: "2026-05-04T19:59:00.000Z",
    });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "fresh-access",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-2",
        scope: "data:read_write,data:delete",
      }),
    }));

    const token = await getTodoistApiToken("u1", {
      dbClient: testState.db.current,
      fetchFn,
      env: {
        TODOIST_CLIENT_ID: "client-id",
        TODOIST_CLIENT_SECRET: "client-secret",
      },
      now: new Date("2026-05-04T20:00:00.000Z"),
    });

    expect(token).toBe("fresh-access");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.todoist.com/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    const body = fetchFn.mock.calls[0][1].body;
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("client-secret");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");

    const row = (await testState.db.current.execute("SELECT * FROM ea_settings WHERE user_id = 'u1'")).rows[0];
    expect(row.todoist_api_token_encrypted).toBe("enc:fresh-access");
    expect(row.todoist_oauth_refresh_token_encrypted).toBe("enc:refresh-2");
    expect(row.todoist_oauth_access_token_expires_at).toBe("2026-05-04T21:00:00.000Z");
    expect(row.todoist_oauth_scope).toBe("data:read_write,data:delete");
    expect(row.todoist_oauth_token_type).toBe("Bearer");
  });

  it("keeps the existing refresh token when Todoist omits it on grace-window retry", async () => {
    await seedSettings({
      accessToken: "expired-access",
      refreshToken: "refresh-2",
      expiresAt: "2026-05-04T19:59:00.000Z",
    });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "fresh-access",
        expires_in: 3600,
      }),
    }));

    await getTodoistApiToken("u1", {
      dbClient: testState.db.current,
      fetchFn,
      env: {
        TODOIST_CLIENT_ID: "client-id",
        TODOIST_CLIENT_SECRET: "client-secret",
      },
      now: new Date("2026-05-04T20:00:00.000Z"),
    });

    const row = (await testState.db.current.execute("SELECT * FROM ea_settings WHERE user_id = 'u1'")).rows[0];
    expect(row.todoist_oauth_refresh_token_encrypted).toBe("enc:refresh-2");
  });

  it("does not corrupt stored credentials when refresh fails", async () => {
    await seedSettings({
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      expiresAt: "2026-05-04T19:59:00.000Z",
    });
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant"}',
    }));

    await expect(getTodoistApiToken("u1", {
      dbClient: testState.db.current,
      fetchFn,
      env: {
        TODOIST_CLIENT_ID: "client-id",
        TODOIST_CLIENT_SECRET: "client-secret",
      },
      now: new Date("2026-05-04T20:00:00.000Z"),
    })).rejects.toThrow("Todoist OAuth refresh failed");

    const row = (await testState.db.current.execute("SELECT * FROM ea_settings WHERE user_id = 'u1'")).rows[0];
    expect(row.todoist_api_token_encrypted).toBe("enc:expired-access");
    expect(row.todoist_oauth_refresh_token_encrypted).toBe("enc:refresh-1");
    expect(row.todoist_oauth_access_token_expires_at).toBe("2026-05-04T19:59:00.000Z");
  });
});

describe("storeTodoistOAuthTokenResponse", () => {
  it("stores the initial OAuth token response as encrypted Todoist credentials", async () => {
    await testState.db.current.execute({
      sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
      args: ["u1"],
    });

    await storeTodoistOAuthTokenResponse("u1", {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "data:read_write,data:delete",
    }, {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T20:00:00.000Z"),
    });

    const row = (await testState.db.current.execute("SELECT * FROM ea_settings WHERE user_id = 'u1'")).rows[0];
    expect(row.todoist_api_token_encrypted).toBe("enc:access-1");
    expect(row.todoist_oauth_refresh_token_encrypted).toBe("enc:refresh-1");
    expect(row.todoist_oauth_access_token_expires_at).toBe("2026-05-04T21:00:00.000Z");
  });

  it("honors explicit expiry metadata when storing an older OAuth token response", async () => {
    await testState.db.current.execute({
      sql: "INSERT INTO ea_settings (user_id) VALUES (?)",
      args: ["u1"],
    });

    await storeTodoistOAuthTokenResponse("u1", {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      issued_at: "2026-05-04T18:55:00.000Z",
    }, {
      dbClient: testState.db.current,
      now: new Date("2026-05-04T20:00:00.000Z"),
    });

    const row = (await testState.db.current.execute("SELECT * FROM ea_settings WHERE user_id = 'u1'")).rows[0];
    expect(row.todoist_oauth_access_token_expires_at).toBe("2026-05-04T19:55:00.000Z");
  });
});
