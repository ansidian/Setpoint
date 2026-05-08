import { describe, expect, it } from "vitest";
import {
  parseEmailSearchHarnessArgs,
  resolveEmailSearchHarnessDbConfig,
} from "./email-search-dev-harness.js";

describe("email search dev harness", () => {
  it("requires bounded backfill limits", () => {
    expect(() => parseEmailSearchHarnessArgs(["--adapter=turso"], {
      command: "backfill",
    })).toThrow(/bounded --limit is required/);

    expect(parseEmailSearchHarnessArgs(["--adapter=turso", "--limit=1000"], {
      command: "backfill",
    })).toMatchObject({
      adapter: "turso",
      limit: 500,
      batchSize: 16,
    });
  });

  it("parses status adapter args without requiring writes", () => {
    expect(parseEmailSearchHarnessArgs(["--adapter", "local"], {
      command: "status",
    })).toMatchObject({
      adapter: "local",
      limit: 25,
    });
  });

  it("maps the Turso harness adapter to explicit Turso database config", () => {
    const config = resolveEmailSearchHarnessDbConfig({
      adapter: "turso",
      env: {
        NODE_ENV: "development",
        TURSO_DATABASE_URL: "libsql://example.turso.io",
        TURSO_AUTH_TOKEN: "token",
      },
    });

    expect(config).toMatchObject({
      mode: "dev-turso",
      adapter: "turso",
      client: {
        url: "libsql://example.turso.io",
        authToken: "token",
      },
    });
  });
});
