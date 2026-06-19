import { describe, expect, it } from "vitest";
import { parseTags, selectVisibleNotes, splitNoteForTask, formatNoteAge } from "./notesModel.js";

describe("parseTags", () => {
  it("extracts, lowercases, and dedupes #tags", () => {
    expect(parseTags("Read #Ideas and more #ideas about #home-office")).toEqual(["ideas", "home-office"]);
  });
  it("ignores # mid-word", () => {
    expect(parseTags("color is #fff but issue a#b is not a tag")).toEqual(["fff"]);
  });
  it("returns [] for empty content", () => {
    expect(parseTags("")).toEqual([]);
  });
});

describe("selectVisibleNotes", () => {
  const notes = [
    { id: 1, content: "active idea #x", archived_at: null },
    { id: 2, content: "archived idea #x", archived_at: "2026-06-01 00:00:00" },
    { id: 3, content: "buy milk", archived_at: null },
  ];
  it("shows only active notes by default", () => {
    expect(selectVisibleNotes({ notes }).map((n) => n.id)).toEqual([1, 3]);
  });
  it("search spans archived notes", () => {
    expect(selectVisibleNotes({ notes, query: "idea" }).map((n) => n.id)).toEqual([1, 2]);
  });
  it("tag filter spans archived notes", () => {
    expect(selectVisibleNotes({ notes, activeTag: "x" }).map((n) => n.id)).toEqual([1, 2]);
  });
});

describe("splitNoteForTask", () => {
  it("uses the first non-empty line as title and the rest as description", () => {
    expect(splitNoteForTask("Renew domain\ncheck the registrar\nGoDaddy")).toEqual({
      title: "Renew domain",
      description: "check the registrar\nGoDaddy",
    });
  });
  it("returns empty description for a single line", () => {
    expect(splitNoteForTask("just a one-liner")).toEqual({ title: "just a one-liner", description: "" });
  });
});

describe("formatNoteAge", () => {
  const now = new Date("2026-06-19T12:00:00Z");
  it("formats sub-day as today and days/weeks otherwise", () => {
    expect(formatNoteAge("2026-06-19 09:00:00", now)).toBe("today");
    expect(formatNoteAge("2026-06-16 12:00:00", now)).toBe("3d");
    expect(formatNoteAge("2026-06-01 12:00:00", now)).toBe("2w");
  });
  it("also parses a JS ISO timestamp (optimistic client write) without blanking", () => {
    expect(formatNoteAge("2026-06-16T12:00:00.000Z", now)).toBe("3d");
  });
});
