import { describe, expect, it } from "vitest";
import { resolveDatabaseClientConfig } from "./config.ts";

describe("database client config", () => {
  it("uses an explicit persistent production file", () => {
    expect(resolveDatabaseClientConfig({
      NODE_ENV: "production", EA_DB_ADAPTER: "sqlite", EA_SQLITE_PATH: "/data/my database.db",
    })).toEqual({ mode: "production", client: { url: "file:///data/my%20database.db" } });
  });

  it.each([undefined, "relative.db", ":memory:", "/data/:memory:"])(
    "rejects unsafe production SQLite paths: %s", (path) => {
      expect(() => resolveDatabaseClientConfig({ NODE_ENV: "production", EA_SQLITE_PATH: path }))
        .toThrow(/absolute persistent file path/);
    },
  );

  it("rejects non-SQLite adapters", () => {
    expect(() => resolveDatabaseClientConfig({ EA_DB_ADAPTER: "turso" })).toThrow(/EA_DB_ADAPTER must be sqlite/);
  });

  it("keeps default development on local SQLite", () => {
    expect(resolveDatabaseClientConfig({ NODE_ENV: "development" })).toEqual({
      mode: "local",
      client: { url: "file:server/db/ea.db" },
    });
  });
});
