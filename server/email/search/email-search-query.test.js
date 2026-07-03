import { describe, expect, it } from "vitest";
import { dateTokenVariants, pluralVariants, sanitizeFtsQuery } from "./email-search-query.js";

describe("pluralVariants", () => {
  it("maps plural to singular and back", () => {
    expect(pluralVariants("statements")).toEqual(["statement"]);
    expect(pluralVariants("statement")).toEqual(["statements"]);
    expect(pluralVariants("activities")).toEqual(["activity"]);
    expect(pluralVariants("activity")).toEqual(["activities"]);
    expect(pluralVariants("boxes")).toEqual(["box"]);
  });
  it("skips short, numeric, and -ss tokens", () => {
    expect(pluralVariants("gas")).toEqual([]);
    expect(pluralVariants("7/7")).toEqual([]);
    expect(pluralVariants("address")).toEqual([]);
  });
});

describe("sanitizeFtsQuery plural expansion", () => {
  // NOTE: joined with explicit "AND", not a bare space. FTS5's implicit-AND adjacency
  // only applies between bare phrases; a parenthesized OR-group next to anything else
  // is a syntax error in the real engine (verified against libsql's fts5 parser, the
  // same parser Turso runs in prod) — confirmed with a live in-memory FTS5 table.
  it("ORs each token with its plural/singular variant, prefix on the last", () => {
    expect(sanitizeFtsQuery("paypal statement")).toBe(
      '("paypal" OR "paypals") AND ("statement"* OR "statements"*)',
    );
  });
  it("keeps single short tokens un-grouped", () => {
    expect(sanitizeFtsQuery("sce")).toBe('"sce"*');
  });
});

describe("dateTokenVariants", () => {
  it("expands slash dates into padded and unpadded adjacency phrases", () => {
    expect(dateTokenVariants("7/7")).toEqual(["07 07", "07 7", "7 07", "7 7"]);
    expect(dateTokenVariants("07/07/2026")).toEqual(["07 07 2026", "07 7 2026", "7 07 2026", "7 7 2026"]);
    expect(dateTokenVariants("06-15")).toEqual(["06 15", "6 15"]);
  });
  it("ignores non-date tokens", () => {
    expect(dateTokenVariants("statement")).toEqual([]);
    expect(dateTokenVariants("24/7/365/x")).toEqual([]);
    expect(dateTokenVariants("123/456")).toEqual([]);
  });
});

describe("sanitizeFtsQuery date expansion", () => {
  // Joined with explicit "AND" (Task 5, 0a01ea07): FTS5's implicit-AND adjacency
  // only holds between bare phrases; a parenthesized OR-group next to anything
  // else is a syntax error in the real engine.
  // NOTE: "due" has length 3, below pluralVariants' MIN_VARIANT_TOKEN_LENGTH (4),
  // so it never gets a plural variant regardless of date-skip logic — that gate
  // is orthogonal to this test. The date-expansion behavior under test is the
  // second group.
  it("ORs the literal token with phrase variants and skips plural expansion", () => {
    expect(sanitizeFtsQuery("due 7/7")).toBe(
      '"due" AND ("7/7"* OR "07 07" OR "07 7" OR "7 07" OR "7 7")',
    );
  });
});
