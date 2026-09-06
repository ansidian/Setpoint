import { describe, expect, it } from "vitest";
import {
  applyAlfredEvent, markAlfredProposalCreated,
  clearUncreatedAlfredProposals
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
  it("appends atomic proposals and supersedes only the referenced active card", () => {
    const first = {
      id: "proposal-1", revisionOf: null, title: "Project review", allDay: false,
      startDate: "2026-08-18", endDate: "2026-08-18", startTime: "15:00", endTime: "15:30",
      location: "", description: "", source: { kind: "unavailable" as const },
      duplicateCheckUnavailable: true, past: false,
    };
    const second = { ...first, id: "proposal-2", revisionOf: "proposal-1", startTime: "16:00", endTime: "16:30" };
    const ms = play([
      { type: "calendar_proposal", proposal: first },
      { type: "calendar_proposal", proposal: second },
    ]);

    expect(ms).toHaveLength(2);
    expect(messageAt(ms, 0, "calendar-proposal").status).toBe("superseded");
    expect(messageAt(ms, 1, "calendar-proposal")).toMatchObject({ status: "proposed", proposal: { id: "proposal-2" } });
  });

  it("uses normalized saved-event truth for Created and clears only uncreated cards at expiry", () => {
    const proposal = {
      id: "proposal-1", revisionOf: null, title: "Project review", allDay: false,
      startDate: "2026-08-18", endDate: "2026-08-18", startTime: "15:00", endTime: "15:30",
      location: "Room 1", description: "", source: { kind: "unavailable" as const },
      duplicateCheckUnavailable: true, past: false,
    };
    const proposed = play([{ type: "calendar_proposal", proposal }]);
    const created = markAlfredProposalCreated(proposed, proposal.id, {
      id: "event-1", title: "Edited title", allDay: false,
      startMs: new Date("2026-08-18T23:00:00.000Z").getTime(),
      endMs: new Date("2026-08-18T23:30:00.000Z").getTime(),
      location: "Room 2", description: "Saved truth", calendarName: "Personal",
      accountId: "account-1", calendarId: "primary",
    } as never);
    expect(messageAt(created, 0, "calendar-proposal")).toMatchObject({
      status: "created",
      editedInCalendar: true,
      createdEvent: { id: "event-1", title: "Edited title" },
    });
    expect(clearUncreatedAlfredProposals([...proposed, ...created])).toHaveLength(1);
    expect(clearUncreatedAlfredProposals([...proposed, ...created])[0]).toMatchObject({ status: "created" });
  });

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
    // The "Checking." preamble survives as a tagged say (quiet prose, not promoted),
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
    // …and only the final answer resolves into the promoted non-preamble treatment.
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
    // …and the headline written after the citation is the promoted non-preamble answer.
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

  it("ignores run_start and unknown events", () => {
    expect(play([
      { type: "run_start", conversation_id: "c", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "mystery" } as unknown as AlfredRunEvent,
    ])).toEqual([]);
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
