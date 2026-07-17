import { describe, expect, it } from "vitest";
import {
  ALFRED_MODELS,
  alfredModelByKey,
  alfredPriorityLabel,
  alfredScrollKey,
  alfredToolRunningLabel,
  applyAlfredEvent,
  countBreakdownRows,
  formatAlfredAbsolute,
  formatAlfredAgo,
  formatAlfredDate,
  isNearBottom,
  spendingBreakdownRows,
  splitSayText,
} from "./alfredPanelModel";
import type { AlfredPanelMessage } from "./alfredPanelModel";
import type { AlfredRunEvent } from "../../../shared/types/alfred";

function play(events: AlfredRunEvent[]): AlfredPanelMessage[] {
  return events.reduce<AlfredPanelMessage[]>((messages, event) => applyAlfredEvent(messages, event), []);
}

function messageAt<T extends AlfredPanelMessage["type"]>(
  messages: AlfredPanelMessage[],
  index: number,
  type: T,
): Extract<AlfredPanelMessage, { type: T }> {
  const message = messages[index];
  expect(message?.type).toBe(type);
  if (!message || message.type !== type) throw new Error(`Expected ${type} message at index ${index}`);
  return message as Extract<AlfredPanelMessage, { type: T }>;
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

  it("keeps the between-tool preamble as a quiet say and coalesces consecutive tool calls", () => {
    const ms = play([
      { type: "text_delta", text: "Checking." },
      { type: "tool_start", tool_id: "t1", name: "get_upcoming_bills" },
      { type: "tool_result", tool_id: "t1", name: "get_upcoming_bills", ok: true, summary: "Bills · 6 upcoming" },
      { type: "tool_start", tool_id: "t2", name: "show_items" },
    ]);
    // The "Checking." preamble survives as a tagged say (quiet prose, not serif),
    // and tools with no narration between them still coalesce into one block.
    expect(ms.map((m) => m.type)).toEqual(["say", "tools"]);
    expect(ms[0]).toMatchObject({ type: "say", text: "Checking.", done: true, preamble: true });
    expect(messageAt(ms, 1, "tools").done).toBe(false); // live while the run is in flight
    expect(messageAt(ms, 1, "tools").tools).toEqual([
      { toolId: "t1", name: "get_upcoming_bills", state: "done", summary: "Bills · 6 upcoming" },
      { toolId: "t2", name: "show_items", state: "running", summary: null },
    ]);
  });

  it("ignores a whitespace-only narration delta instead of leaving an empty preamble block", () => {
    // Models often emit a leading "\n" or space before the first tool_use. The old
    // dropOpenSay deleted these silently; keeping the say must not leave a blank line.
    const ms = play([
      { type: "text_delta", text: "\n" },
      { type: "tool_start", tool_id: "t1", name: "search_email" },
    ]);
    expect(ms.map((m) => m.type)).toEqual(["tools"]);
  });

  it("keeps the preamble before tools and the answer text after them", () => {
    const ms = play([
      { type: "text_delta", text: "One sec." },
      { type: "tool_start", tool_id: "t1", name: "search_email" },
      { type: "tool_result", tool_id: "t1", name: "search_email", ok: true, summary: "Mail · 4 matches" },
      { type: "text_delta", text: "Found it." },
    ]);
    // preamble (quiet) → tools (settled by the new narration) → answer (still open)
    expect(ms.map((m) => m.type)).toEqual(["say", "tools", "say"]);
    expect(ms[0]).toMatchObject({ text: "One sec.", done: true, preamble: true });
    expect(messageAt(ms, 1, "tools").done).toBe(true); // a fresh narration settles the preceding tools block
    expect(ms[2]).toMatchObject({ text: "Found it.", done: false });
    expect(messageAt(ms, 2, "say").preamble).toBeFalsy();
  });

  it("keeps every between-tool narration so multi-step runs read like an agentic trail", () => {
    // The reported regression: narration said before a tool call vanished the
    // instant the tool started. Each narration must persist, interleaved with the
    // tool block it introduced, and earlier blocks must settle (not spin forever).
    const ms = play([
      { type: "text_delta", text: "Let me search your mail." },
      { type: "tool_start", tool_id: "t1", name: "search_email" },
      { type: "tool_result", tool_id: "t1", name: "search_email", ok: true, summary: "Mail · 12 matches" },
      { type: "text_delta", text: 'Let me read a few more confirmation emails to better understand what constitutes "nothing after applied," and check for more rejections.' },
      { type: "tool_start", tool_id: "t2", name: "get_email_body" },
      { type: "tool_result", tool_id: "t2", name: "get_email_body", ok: true, summary: "Mail · opened message" },
      { type: "text_delta", text: "Here's what I found." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    expect(ms.map((m) => m.type)).toEqual(["say", "tools", "say", "tools", "say"]);
    // Both narrations persisted as quiet preambles…
    expect(ms[0]).toMatchObject({ text: "Let me search your mail.", preamble: true, done: true });
    expect(ms[2]).toMatchObject({ preamble: true, done: true });
    expect(messageAt(ms, 2, "say").text).toContain("read a few more confirmation emails");
    // …each introducing its own settled tool block (no lingering spinner)…
    expect(ms[1]).toMatchObject({ type: "tools", done: true });
    expect(ms[3]).toMatchObject({ type: "tools", done: true });
    // …and only the final answer resolves into the serif (non-preamble) line.
    expect(ms[4]).toMatchObject({ text: "Here's what I found.", done: true });
    expect(messageAt(ms, 4, "say").preamble).toBeFalsy();
  });

  it("marks the active tools block done on run_end so it collapses to a steps disclosure", () => {
    const ms = play([
      { type: "text_delta", text: "Let me look." },
      { type: "tool_start", tool_id: "t1", name: "search_email" },
      { type: "tool_result", tool_id: "t1", name: "search_email", ok: true, summary: "Mail · 4 matches" },
      { type: "text_delta", text: "Here is the split." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    expect(ms.map((m) => m.type)).toEqual(["say", "tools", "say"]);
    expect(ms[0]).toMatchObject({ text: "Let me look.", preamble: true, done: true });
    expect(messageAt(ms, 1, "tools").done).toBe(true); // collapsed once the run ends
    expect(ms[2]).toMatchObject({ type: "say", text: "Here is the split.", done: true });
    expect(messageAt(ms, 2, "say").preamble).toBeFalsy();
  });

  it("settles every live tools block at run_end, even one left live by an intervening rows emission", () => {
    // rows emitted mid-tool leaves its tools block live; a later narration opens a
    // new block without settling that earlier one (settleTrailingTools only catches
    // a tools block at the tail). finishTools must settle BOTH at run_end — the old
    // settle-only-the-last behavior would leave the first block spinning forever.
    const ms = play([
      { type: "text_delta", text: "Let me pull those up." },
      { type: "tool_start", tool_id: "t1", name: "show_items" },
      { type: "rows", kind: "bill", items: [{ id: "b1", scheduleId: "s1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false, type: "bill", openActionDisabled: false }] },
      { type: "tool_result", tool_id: "t1", name: "show_items", ok: true, summary: "Bills · 1 upcoming" },
      { type: "text_delta", text: "Now checking your deadlines." },
      { type: "tool_start", tool_id: "t2", name: "get_deadlines" },
      { type: "tool_result", tool_id: "t2", name: "get_deadlines", ok: true, summary: "Deadlines · 2" },
      { type: "text_delta", text: "Rent is due and you have 2 deadlines." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const tools = ms.filter((m) => m.type === "tools");
    expect(tools).toHaveLength(2);
    expect(tools.every((t) => t.done)).toBe(true); // both blocks settled — no lingering spinner
    // The two narration lines stay quiet preambles…
    expect(ms.filter((m) => m.type === "say" && m.preamble)).toHaveLength(2);
    // …and the headline written after the citation is the serif (non-preamble) answer.
    const answer = messageAt(ms, ms.length - 1, "say");
    expect(answer).toMatchObject({ type: "say", text: "Rent is due and you have 2 deadlines.", done: true });
    expect(answer.preamble).toBeFalsy();
  });

  it("run_error also closes the active tools block and appends the error line", () => {
    const ms = play([
      { type: "tool_start", tool_id: "t1", name: "search_email" },
      { type: "tool_result", tool_id: "t1", name: "search_email", ok: true, summary: "Mail · 4 matches" },
      { type: "run_error", message: "Alfred hit the tool-call limit." },
    ]);
    expect(ms.map((m) => m.type)).toEqual(["tools", "error"]);
    expect(messageAt(ms, 0, "tools").done).toBe(true);
    expect(messageAt(ms, 1, "error").text).toBe("Alfred hit the tool-call limit.");
  });

  it("marks a failed tool as error without halting", () => {
    const ms = play([
      { type: "tool_start", tool_id: "t1", name: "get_email_body" },
      { type: "tool_result", tool_id: "t1", name: "get_email_body", ok: false, summary: "Mail · failed" },
    ]);
    expect(messageAt(ms, 0, "tools").tools[0]).toMatchObject({ state: "error", summary: "Mail · failed" });
  });

  it("appends rows messages and closes the open say", () => {
    const ms = play([
      { type: "text_delta", text: "Here:" },
      { type: "rows", kind: "bill", items: [{ id: "b1", scheduleId: "s1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false, type: "bill", openActionDisabled: false }] },
    ]);
    expect(ms.map((m) => m.type)).toEqual(["say", "rows"]);
    expect(messageAt(ms, 1, "rows").kind).toBe("bill");
    expect(messageAt(ms, 1, "rows").items[0]?.name).toBe("Rent");
  });

  it("run_end closes the open say; run_error appends an error line", () => {
    const ended = play([{ type: "text_delta", text: "Done." }, { type: "run_end", stop_reason: "end_turn" }]);
    expect(messageAt(ended, 0, "say").done).toBe(true);

    const errored = play([{ type: "run_error", message: "Alfred could not complete this run." }]);
    expect(errored[0]).toMatchObject({ type: "error", text: "Alfred could not complete this run." });
  });

  it("ignores run_start and unknown events", () => {
    expect(play([
      { type: "run_start", conversation_id: "c", model: "claude-sonnet-4-6" },
      { type: "mystery" } as unknown as AlfredRunEvent,
    ])).toEqual([]);
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
    expect(alfredToolRunningLabel("summarize_transactions")).toBe("Tallying transactions…");
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

describe("spendingBreakdownRows", () => {
  it("returns [] for empty input", () => {
    expect(spendingBreakdownRows([])).toEqual([]);
    expect(spendingBreakdownRows()).toEqual([]);
  });

  it("largest bucket gets pct === 100", () => {
    const rows = spendingBreakdownRows([{ label: "Groceries", amount: 100, count: 3 }]);
    expect(rows[0]!.pct).toBe(100);
  });

  it("a half-size bucket gets pct === 50", () => {
    const rows = spendingBreakdownRows([
      { label: "Groceries", amount: 100, count: 3 },
      { label: "Dining", amount: 50, count: 2 },
    ]);
    expect(rows[0]!.pct).toBe(100);
    expect(rows[1]!.pct).toBe(50);
  });

  it("marks Other rows with isOther: true", () => {
    const rows = spendingBreakdownRows([
      { label: "Groceries", amount: 80, count: 2 },
      { label: "Other", amount: 20, count: 5 },
    ]);
    expect(rows[0]!.isOther).toBe(false);
    expect(rows[1]!.isOther).toBe(true);
  });
});

describe("applyAlfredEvent summary case", () => {
  it("appends a summary message and closes the open say", () => {
    const ms: AlfredPanelMessage[] = [
      { id: "am1", type: "say", text: "Here:", done: false },
    ];
    const result = applyAlfredEvent(ms, {
      type: "summary",
      total: 200,
      period: { start: "2026-06-01", end: "2026-06-30" },
      group_by: "category",
      buckets: [{ label: "Groceries", amount: 82, count: 2 }],
    });
    expect(result.map((m) => m.type)).toEqual(["say", "summary"]);
    expect(messageAt(result, 0, "say").done).toBe(true);
    const summary = messageAt(result, 1, "summary");
    expect(summary.total).toBe(200);
    expect(summary.group_by).toBe("category");
    expect(summary.buckets[0]?.label).toBe("Groceries");
    expect(summary.period).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
});

describe("countBreakdownRows", () => {
  it("computes pct from the max count and flags Other", () => {
    const rows = countBreakdownRows([
      { label: "Ghosted", count: 16 },
      { label: "Rejected", count: 4 },
      { label: "Other", count: 2 },
    ]);
    expect(rows[0]!).toEqual({ label: "Ghosted", count: 16, pct: 100, isOther: false });
    expect(rows[1]!.pct).toBe(25);
    expect(rows[2]!.isOther).toBe(true);
  });

  it("preserves incoming order and returns [] for empty", () => {
    expect(countBreakdownRows([])).toEqual([]);
    const rows = countBreakdownRows([{ label: "B", count: 1 }, { label: "A", count: 9 }]);
    expect(rows.map((r) => r.label)).toEqual(["B", "A"]);
  });

  it("rounds pct to one decimal and stays 0..100", () => {
    const rows = countBreakdownRows([{ label: "Max", count: 3 }, { label: "Third", count: 1 }]);
    expect(rows[0]!.pct).toBe(100);
    expect(rows[1]!.pct).toBe(33.3); // 1/3 → 33.333 → rounded to 0.1
  });

  it("is zero-safe when every count is zero", () => {
    const rows = countBreakdownRows([{ label: "A", count: 0 }, { label: "B", count: 0 }]);
    expect(rows.map((r) => r.pct)).toEqual([0, 0]);
  });
});

describe("applyAlfredEvent breakdown", () => {
  it("turns a breakdown event into a breakdown message", () => {
    const out = applyAlfredEvent([], {
      type: "breakdown", kind: "email", title: "By status", caption: "last 3 months", total: 8,
      buckets: [{ label: "Ghosted", count: 6, items: [] }, { label: "Rejected", count: 2, items: [] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "breakdown", kind: "email", title: "By status", caption: "last 3 months", total: 8 });
    const breakdown = messageAt(out, 0, "breakdown");
    expect(breakdown.buckets.map((bucket) => bucket.label)).toEqual(["Ghosted", "Rejected"]);
    expect(breakdown.id).toBeTruthy();
  });

  it("closes an open say block before the breakdown", () => {
    const out = play([
      { type: "text_delta", text: "Here is the split." },
      { type: "breakdown", kind: "email", title: "x", total: 0, buckets: [] },
    ]);
    expect(messageAt(out, 0, "say").done).toBe(true);
    expect(messageAt(out, 1, "breakdown")).toBeTruthy();
  });

  it("absorbs a prior same-kind flat rows block the card already contains (no duplicate list)", () => {
    // On a split question Haiku may render show_items (a flat list) before the
    // breakdown card; the card lists the same items inside its buckets, so the
    // flat list would duplicate every row. The card is the sole surface.
    const out = play([
      { type: "rows", kind: "email", items: [{ uid: "em-1" }, { uid: "em-2" }, { uid: "em-3" }] },
      { type: "breakdown", kind: "email", title: "By outcome", total: 3, buckets: [
        { label: "Rejections", count: 2, items: [{ uid: "em-1" }, { uid: "em-2" }] },
        { label: "Ghosted", count: 1, items: [{ uid: "em-3" }] },
      ] },
    ]);
    expect(out.filter((m) => m.type === "rows")).toHaveLength(0);
    expect(out.filter((m) => m.type === "breakdown")).toHaveLength(1);
  });

  it("keeps a flat rows block the card does not fully contain (different kind or extra items)", () => {
    const differentKind = play([
      { type: "rows", kind: "bill", items: [{ id: "b1", scheduleId: "s1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false, type: "bill", openActionDisabled: false }] },
      { type: "breakdown", kind: "email", title: "x", total: 1, buckets: [{ label: "A", count: 1, items: [{ uid: "em-1" }] }] },
    ]);
    expect(differentKind.filter((m) => m.type === "rows")).toHaveLength(1);

    const extraItem = play([
      { type: "rows", kind: "email", items: [{ uid: "em-1" }, { uid: "em-9" }] },
      { type: "breakdown", kind: "email", title: "x", total: 1, buckets: [{ label: "A", count: 1, items: [{ uid: "em-1" }] }] },
    ]);
    expect(extraItem.filter((m) => m.type === "rows")).toHaveLength(1);
  });
});
