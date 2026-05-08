import { describe, expect, it } from "vitest";
import { resolveDatabaseClientConfig } from "./config.js";

describe("database client config", () => {
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
