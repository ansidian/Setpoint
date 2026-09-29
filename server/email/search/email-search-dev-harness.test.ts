import { describe, expect, it } from "vitest";
import { parseEmailSearchHarnessArgs } from "./email-search-dev-harness.ts";

describe("email search dev harness", () => {
  it("requires bounded backfill limits", () => {
    expect(() => parseEmailSearchHarnessArgs([], {
      command: "backfill",
    })).toThrow(/bounded --limit is required/);

    expect(parseEmailSearchHarnessArgs(["--limit=1000"], {
      command: "backfill",
    })).toMatchObject({
      limit: 500,
      batchSize: 16,
    });
  });

  it("defaults status to a bounded read without requiring writes", () => {
    expect(parseEmailSearchHarnessArgs([], {
      command: "status",
    })).toMatchObject({
      limit: 25,
    });
  });
});
