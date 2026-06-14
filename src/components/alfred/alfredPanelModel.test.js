import { describe, expect, it } from "vitest";
import {
  ALFRED_MODELS,
  alfredModelByKey,
  alfredPriorityLabel,
  alfredScrollKey,
  alfredToolRunningLabel,
  applyAlfredEvent,
  formatAlfredAbsolute,
  formatAlfredAgo,
  formatAlfredDate,
  isNearBottom,
  splitSayText,
} from "./alfredPanelModel.js";

function play(events) {
  return events.reduce((ms, e) => applyAlfredEvent(ms, e), []);
}

describe("applyAlfredEvent", () => {
  it("streams consecutive text deltas into one say message", () => {
    const ms = play([
      { type: "text_delta", text: "Two things " },
      { type: "text_delta", text: "need you." },
    ]);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ type: "say", text: "Two things need you.", done: false });
  });

  it("groups consecutive tool calls into one tools block and closes the open say", () => {
    const ms = play([
      { type: "text_delta", text: "Checking." },
      { type: "tool_start", tool_id: "t1", name: "get_upcoming_bills" },
      { type: "tool_result", tool_id: "t1", name: "get_upcoming_bills", ok: true, summary: "Bills · 6 upcoming" },
      { type: "tool_start", tool_id: "t2", name: "show_items" },
    ]);
    expect(ms.map((m) => m.type)).toEqual(["say", "tools"]);
    expect(ms[0].done).toBe(true);
    expect(ms[1].tools).toEqual([
      { toolId: "t1", name: "get_upcoming_bills", state: "done", summary: "Bills · 6 upcoming" },
      { toolId: "t2", name: "show_items", state: "running", summary: null },
    ]);
  });

  it("text after tools starts a new say block", () => {
    const ms = play([
      { type: "text_delta", text: "One sec." },
      { type: "tool_start", tool_id: "t1", name: "search_email" },
      { type: "tool_result", tool_id: "t1", name: "search_email", ok: true, summary: "Mail · 4 matches" },
      { type: "text_delta", text: "Found it." },
    ]);
    expect(ms.map((m) => m.type)).toEqual(["say", "tools", "say"]);
    expect(ms[2].text).toBe("Found it.");
  });

  it("marks a failed tool as error without halting", () => {
    const ms = play([
      { type: "tool_start", tool_id: "t1", name: "get_email_body" },
      { type: "tool_result", tool_id: "t1", name: "get_email_body", ok: false, summary: "Mail · failed" },
    ]);
    expect(ms[0].tools[0]).toMatchObject({ state: "error", summary: "Mail · failed" });
  });

  it("appends rows messages and closes the open say", () => {
    const ms = play([
      { type: "text_delta", text: "Here:" },
      { type: "rows", kind: "bill", items: [{ id: "b1", name: "Rent", amount: 1850 }] },
    ]);
    expect(ms.map((m) => m.type)).toEqual(["say", "rows"]);
    expect(ms[1].kind).toBe("bill");
    expect(ms[1].items[0].name).toBe("Rent");
  });

  it("run_end closes the open say; run_error appends an error line", () => {
    const ended = play([{ type: "text_delta", text: "Done." }, { type: "run_end", stop_reason: "end_turn" }]);
    expect(ended[0].done).toBe(true);

    const errored = play([{ type: "run_error", message: "Alfred could not complete this run." }]);
    expect(errored[0]).toMatchObject({ type: "error", text: "Alfred could not complete this run." });
  });

  it("ignores run_start and unknown events", () => {
    expect(play([{ type: "run_start", conversation_id: "c" }, { type: "mystery" }])).toEqual([]);
  });
});

describe("splitSayText", () => {
  it("splits the first sentence as the serif lead", () => {
    expect(splitSayText("Two things need you. The rest can wait.")).toEqual({
      lead: "Two things need you.",
      body: "The rest can wait.",
    });
  });

  it("does not split on decimal points and strips markdown bold", () => {
    expect(splitSayText("**Rent** is $1,850.00 due Friday")).toEqual({
      lead: "Rent is $1,850.00 due Friday",
      body: "",
    });
  });

  it("splits on the first newline when it comes before a sentence end", () => {
    expect(splitSayText("Heads up\nRent lands Friday.")).toEqual({
      lead: "Heads up",
      body: "Rent lands Friday.",
    });
  });
});

describe("helpers", () => {
  it("maps model keys to allowlisted ids", () => {
    expect(ALFRED_MODELS.map((m) => m.id)).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
    ]);
    expect(alfredModelByKey("haiku").id).toBe("claude-haiku-4-5-20251001");
    expect(alfredModelByKey("nope").key).toBe("sonnet");
  });

  it("labels running tools quietly", () => {
    expect(alfredToolRunningLabel("search_email")).toBe("Searching mail…");
    expect(alfredToolRunningLabel("get_upcoming_bills")).toBe("Checking bills…");
    expect(alfredToolRunningLabel("unknown_tool")).toBe("Working…");
  });

  it("labels the transaction tools while running", () => {
    expect(alfredToolRunningLabel("search_transactions")).toBe("Searching transactions…");
    expect(alfredToolRunningLabel("summarize_spending")).toBe("Tallying spending…");
  });

  it("formats dates and priorities", () => {
    expect(formatAlfredDate("2026-06-21")).toBe("Jun 21");
    expect(formatAlfredDate(null)).toBe("");
    expect(alfredPriorityLabel(4)).toBe("P1");
    expect(alfredPriorityLabel(1)).toBeNull();
    expect(formatAlfredAgo("2026-06-12T17:30:00.000Z", new Date("2026-06-12T18:00:00.000Z"))).toBe("30m ago");
    expect(formatAlfredAgo("2026-06-10T18:00:00.000Z", new Date("2026-06-12T18:00:00.000Z"))).toBe("2d ago");
  });
});

describe("auto-scroll decision (P3-4)", () => {
  it("isNearBottom is true at the bottom and within the threshold", () => {
    // parked exactly at the bottom: 1000 - (800 + 200) === 0
    expect(isNearBottom(800, 200, 1000)).toBe(true);
    // 40px from the bottom is still "near" (default threshold)
    expect(isNearBottom(760, 200, 1000)).toBe(true);
    // 41px from the bottom is not
    expect(isNearBottom(759, 200, 1000)).toBe(false);
  });

  it("isNearBottom is true when content does not overflow yet", () => {
    expect(isNearBottom(0, 400, 300)).toBe(true);
  });

  it("isNearBottom respects a custom threshold and coerces junk to 0", () => {
    expect(isNearBottom(700, 200, 1000, 120)).toBe(true);
    expect(isNearBottom(679, 200, 1000, 120)).toBe(false);
    expect(isNearBottom(undefined, undefined, undefined)).toBe(true);
  });

  it("alfredScrollKey bumps on new messages and on tail growth", () => {
    expect(alfredScrollKey([])).toBe("0");
    const one = [{ type: "say", text: "Hi" }];
    const grown = [{ type: "say", text: "Hi there" }];
    const two = [{ type: "say", text: "Hi" }, { type: "say", text: "More" }];
    expect(alfredScrollKey(one)).toBe("1:2");
    // same message count, longer streamed text → different key
    expect(alfredScrollKey(grown)).not.toBe(alfredScrollKey(one));
    // new message appended → different key
    expect(alfredScrollKey(two)).not.toBe(alfredScrollKey(one));
    // a message without text (e.g. tools/rows) contributes tail length 0
    expect(alfredScrollKey([{ type: "tools", tools: [] }])).toBe("1:0");
  });
});

describe("formatAlfredAbsolute", () => {
  it("renders a full absolute date with year for a valid timestamp", () => {
    const out = formatAlfredAbsolute("2026-06-05T19:42:00.000Z");
    expect(out).toContain("2026");
    expect(out).toMatch(/Jun/);
  });

  it("returns an empty string for a missing or invalid timestamp", () => {
    expect(formatAlfredAbsolute("")).toBe("");
    expect(formatAlfredAbsolute("not-a-date")).toBe("");
  });
});
