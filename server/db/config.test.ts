import { describe, expect, it } from "vitest";
import { resolveDatabaseClientConfig } from "./config.ts";

describe("database client config", () => {
  it("uses an explicit persistent local production file without cloud credentials", () => {
    expect(resolveDatabaseClientConfig({
      NODE_ENV: "production", EA_DB_ADAPTER: "sqlite", EA_SQLITE_PATH: "/data/my database.db",
      TURSO_DATABASE_URL: "libsql://unused.turso.io", TURSO_AUTH_TOKEN: "unused",
      AI_SEARCH_VECTOR_ADAPTER: "turso",
    })).toEqual({ mode: "production", adapter: "sqlite", client: { url: "file:///data/my%20database.db" } });
  });

  it.each([undefined, "relative.db", ":memory:", "/data/:memory:"])(
    "rejects unsafe production SQLite paths: %s", (path) => {
      expect(() => resolveDatabaseClientConfig({ NODE_ENV: "production", EA_DB_ADAPTER: "sqlite", EA_SQLITE_PATH: path }))
        .toThrow(/absolute persistent file path/);
    },
  );

  it("rejects unknown adapters and keeps production Turso as the default", () => {
    expect(() => resolveDatabaseClientConfig({ EA_DB_ADAPTER: "other" })).toThrow(/EA_DB_ADAPTER/);
    expect(() => resolveDatabaseClientConfig({ NODE_ENV: "production" })).toThrow(/production database/);
  });

  it("keeps default development on local SQLite", () => {
    expect(resolveDatabaseClientConfig({ NODE_ENV: "development" })).toEqual({
      mode: "local",
      adapter: "sqlite",
      client: { url: "file:server/db/ea.db" },
    });
  });

  it("requires explicit Turso env vars for opt-in AI search vector dev mode", () => {
    expect(() => resolveDatabaseClientConfig({
      NODE_ENV: "development",
      AI_SEARCH_VECTOR_ADAPTER: "turso",
    })).toThrow(/opt-in Turso AI search dev mode: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN/);
  });

  it("uses Turso when the dev adapter is explicitly selected", () => {
    expect(resolveDatabaseClientConfig({
      NODE_ENV: "development",
      EA_DEV_DB_ADAPTER: "turso",
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      TURSO_AUTH_TOKEN: "token",
    })).toEqual({
      mode: "dev-turso",
      adapter: "turso",
      client: {
        url: "libsql://example.turso.io",
        authToken: "token",
      },
    });
  });
});
