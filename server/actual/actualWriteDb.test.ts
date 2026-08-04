import { describe, it, expect } from "vitest";
import { quoteIdent, insertRowQuery, updateRowQuery } from "./actualWriteDb.ts";

describe("actualWriteDb query builders", () => {
  it("quotes valid identifiers and rejects bad ones", () => {
    expect(quoteIdent("foo_1")).toBe('"foo_1"');
    expect(() => quoteIdent("a-b")).toThrow();
  });
  it("filters undefined/null and unknown columns on insert", () => {
    const q = insertRowQuery("payees", "id1", { name: "X", junk: 1, skip: null }, new Set(["name"]));
    // test-architecture: allow-sql-contract -- Actual's provider-owned SQLite schema requires allowlisted quoted identifiers and matching placeholders for lightweight writes.
    expect(q.sql).toBe('INSERT INTO "payees" ("id", "name") VALUES (?, ?)');
    // test-architecture: allow-sql-contract -- Actual's provider database compatibility fixes the id/value placeholder order for the generated insert.
    expect(q.args).toEqual(["id1", "X"]);
    expect(q.messages.map((m) => m.column)).toEqual(["name"]);
  });
  it("returns null for an empty update", () => {
    expect(updateRowQuery("payees", "id1", { junk: 1 }, new Set(["name"]))).toBeNull();
  });
});
