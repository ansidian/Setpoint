import { describe, expect, it } from "vitest";
import { parseTags, selectVisibleNotes, splitNoteForTask, formatNoteAge, stripTags, noteEditedAge } from "./notesModel";

describe("parseTags", () => {
  it("extracts, lowercases, and dedupes #tags", () => {
    expect(parseTags("Read #Ideas and more #ideas about #home-office")).toEqual(["ideas", "home-office"]);
  });
  it("ignores # mid-word", () => {
    expect(parseTags("color is #fff but issue a#b is not a tag")).toEqual(["fff"]);
  });
  it("does not treat a markdown heading marker '# ' as a tag", () => {
    expect(parseTags("# Heading\nsome body")).toEqual([]);
  });
  it("still parses an inline #tag that appears inside a heading line", () => {
    expect(parseTags("# My #project notes")).toEqual(["project"]);
  });
  it("treats a numeric #tag as a tag", () => {
    expect(parseTags("ship #5 and #1")).toEqual(["5", "1"]);
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
  it("the archived view shows only archived notes", () => {
    expect(selectVisibleNotes({ notes, view: "archived" }).map((n) => n.id)).toEqual([2]);
  });
  it("search is scoped to the active view by default", () => {
    expect(selectVisibleNotes({ notes, query: "idea" }).map((n) => n.id)).toEqual([1]);
  });
  it("search within the archived view spans archived notes", () => {
    expect(selectVisibleNotes({ notes, query: "idea", view: "archived" }).map((n) => n.id)).toEqual([2]);
  });
  it("tag filter is scoped to the current view", () => {
    expect(selectVisibleNotes({ notes, activeTag: "x" }).map((n) => n.id)).toEqual([1]);
    expect(selectVisibleNotes({ notes, activeTag: "x", view: "archived" }).map((n) => n.id)).toEqual([2]);
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

describe("stripTags", () => {
  it("removes a trailing anchored tag and trims the gap", () => {
    expect(stripTags("Renew the domain #admin")).toBe("Renew the domain");
  });
  it("removes mid-text tags and collapses the doubled space", () => {
    expect(stripTags("call #john about #x")).toBe("call about");
  });
  it("keeps a mid-word # and a heading marker", () => {
    expect(stripTags("see issue#123\n# Heading")).toBe("see issue#123\n# Heading");
  });
  it("preserves line count so checkbox indices stay aligned", () => {
    expect(stripTags("- [ ] a #x\n- [ ] b").split("\n")).toEqual(["- [ ] a", "- [ ] b"]);
  });
});

describe("noteEditedAge", () => {
  const now = new Date("2026-06-19T12:00:00Z");
  it("returns null when updated_at is within a minute of created_at (the initial write)", () => {
    expect(noteEditedAge({ created_at: "2026-06-19 11:59:30", updated_at: "2026-06-19T11:59:40.000Z" }, now)).toBeNull();
  });
  it("labels a real later edit using the updated_at age (Date compare across formats)", () => {
    expect(noteEditedAge({ created_at: "2026-06-10 12:00:00", updated_at: "2026-06-18T12:00:00.000Z" }, now)).toBe("1d");
  });
  it("returns null when updated_at is missing", () => {
    expect(noteEditedAge({ created_at: "2026-06-10 12:00:00" }, now)).toBeNull();
  });
});
