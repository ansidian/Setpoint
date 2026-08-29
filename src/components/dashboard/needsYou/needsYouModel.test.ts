import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildNeedsYouModel, collectNeedsYouCandidateIds } from "./needsYouModel";
import type { NeedsYouBill, NeedsYouDeadline, NeedsYouEmail, NeedsYouLanes } from "./needsYouModel";

// Classification flows through daysUntil() (real Pacific wall clock), so freeze
// time here rather than threading an injected `now` — mirrors comingUpModel /
// ContextColumn (Tasks 10/13). The fixture dates classify against this instant:
// 2026-06-18 is overdue and 2026-06-19 is due-today at noon Pacific.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-19T12:00:00-07:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

type CompleteNeedsYouLanes = Required<NeedsYouLanes>;

const lanes = (over: Partial<CompleteNeedsYouLanes> = {}): CompleteNeedsYouLanes => ({
  needs_attention: [
    { id: 1, snapshot_item_id: 1, uid: "u1", lane: "needs_attention", from: "Riley Park", subject: "PR blocker: source retry copy", read: false, urgency: "high", date: "2026-06-19T18:42:00.000Z" },
    { id: 2, snapshot_item_id: 2, uid: "u2", lane: "needs_attention", from: "Jamie Rivera", subject: "Senior frontend screen — Thursday?", read: false, urgency: "high", date: "2026-06-19T18:00:00.000Z" },
  ],
  fyi: [
    { id: 3, snapshot_item_id: 3, uid: "u3", lane: "fyi", from: "Sync Monitor", subject: "Calendar coverage report", read: false, urgency: "low", date: "2026-06-19T17:00:00.000Z" },
  ],
  carryover: [],
  ...over,
});
const deadlines: { upcoming: NeedsYouDeadline[] } = {
  upcoming: [
    { id: "pr", title: "Respond to PR review: calendar source moves", due_date: "2026-06-18", status: "open", priority: 1, class_name: "Engineering" }, // overdue
    { id: "demolink", title: "Send portfolio demo link", due_date: "2026-06-19", status: "open", priority: 2, class_name: "Career" }, // due today
    { id: "later", title: "Walkthrough notes", due_date: "2026-06-22", status: "open", priority: 2, class_name: "Portfolio" }, // future → backfill
  ],
};
const bills: NeedsYouBill[] = [
  { id: "rent", name: "Rent — Northstar Lofts", payee: "Northstar", amount: 2450, next_date: "2026-06-19", paid: false }, // due today
  { id: "electric", name: "Demo Electric", payee: "Demo Electric", amount: 146.32, next_date: "2026-06-23", paid: false }, // future → backfill
];

describe("buildNeedsYouModel count", () => {
  it("counts urgent emails + overdue/due-today deadlines + due-today unpaid bills", () => {
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills });
    expect(m.countN).toBe(5);
  });

  it("is empty when no urgent items", () => {
    const m = buildNeedsYouModel({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(m.countN).toBe(0);
    expect(m.urgentCards).toEqual([]);
  });
});

describe("buildNeedsYouModel breakdown + cards", () => {
  it("interleaves urgent cards by rank: overdue deadline, due-today bill, due-today deadline, then emails; capped at maxCards", () => {
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills, maxCards: 5 });
    expect(m.urgentCards.map((c) => c.id)).toEqual(["deadline:pr", "bill:rent", "deadline:demolink", "email:1", "email:2"]);
    expect(m.urgentCards.every((c) => c.kind === "urgent")).toBe(true);
    expect(m.backfillCards).toEqual([]);
    expect(m.moreCount).toBe(0);
  });

  it("backfills spare slots with the next upcoming items (quiet 'Coming up'), never overlapping urgent items", () => {
    const m = buildNeedsYouModel({
      snapshotLanes: lanes({ needs_attention: [lanes().needs_attention[0]!] }),
      liveDeadlines: { upcoming: [deadlines.upcoming[2]!] },
      liveBills: [bills[1]!],
      maxCards: 5,
    });
    expect(m.urgentCards.map((c) => c.id)).toEqual(["email:1"]);
    expect(m.backfillCards.length).toBe(2);
    expect(m.backfillCards[0]!.kind).toBe("backfill");
    expect(m.backfillCards.map((c) => c.title)).toEqual(["Walkthrough notes", "Demo Electric"]);
  });

  it("shows every urgent card and appends at most two future cards in an unbounded rail", () => {
    const m = buildNeedsYouModel({
      snapshotLanes: lanes(),
      liveDeadlines: deadlines,
      liveBills: bills,
      maxCards: Infinity,
    });

    expect(m.urgentCards).toHaveLength(5);
    expect(m.backfillCards.map((card) => card.title)).toEqual(["Walkthrough notes", "Demo Electric"]);
    expect(m.moreCount).toBe(0);
  });

  it("emits moreCount/+N and suppresses backfill when urgent items overflow maxCards", () => {
    const manyEmails: CompleteNeedsYouLanes = { needs_attention: Array.from({ length: 6 }, (_, i): NeedsYouEmail => ({ id: 100 + i, snapshot_item_id: 100 + i, uid: `e${i}`, lane: "needs_attention", from: `S${i}`, subject: `Email ${i}`, read: false, urgency: "high" })), fyi: [], carryover: [] };
    const m = buildNeedsYouModel({ snapshotLanes: manyEmails, liveDeadlines: { upcoming: [deadlines.upcoming[2]!] }, liveBills: [], maxCards: 5 });
    expect(m.urgentCards.length).toBe(5);
    expect(m.moreCount).toBe(1);
    expect(m.backfillCards).toEqual([]);
  });
});

describe("collectNeedsYouCandidateIds", () => {
  it("includes ids for urgent emails, deadlines, bills, and backfill items — including ids currently in handled", () => {
    // handled/opened must NOT be threaded into the candidate collection: the
    // whole point is to compute the full server-derived id universe BEFORE the
    // handled filters remove anything, so a previously-handled-but-re-surfaced
    // id is still recognized as a live candidate.
    const ids = collectNeedsYouCandidateIds({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills });
    // Urgent: overdue/due-today deadlines, due-today bills, urgent emails.
    expect(ids.has("deadline:pr")).toBe(true);
    expect(ids.has("email:1")).toBe(true);
    expect(ids.has("email:2")).toBe(true);
    expect(ids.has("bill:rent")).toBe(true);
    expect(ids.has("deadline:demolink")).toBe(true);
    // Backfill (future, not yet urgent): deadline:later + bill:electric.
    expect(ids.has("deadline:later")).toBe(true);
    expect(ids.has("bill:electric")).toBe(true);
  });

  it("still returns an id that the handled filter would otherwise have removed", () => {
    const emailId = `email:${lanes().needs_attention[0]!.id}`;
    const ids = collectNeedsYouCandidateIds({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills });
    // Sanity: buildNeedsYouModel WOULD drop this id from urgentCards when handled.
    const modelWithHandled = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills, handled: [emailId] });
    expect(modelWithHandled.urgentCards.find((c) => c.id === emailId)).toBeUndefined();
    // But the candidate set still contains it — pruning is keyed off this, not the model.
    expect(ids.has(emailId)).toBe(true);
  });

});

describe("buildNeedsYouModel email open/handled transitions + inbox rows", () => {
  it("keeps a READ but unhandled needs-attention email in the band — reading alone does not clear it", () => {
    const readLanes = lanes({ needs_attention: [{ ...lanes().needs_attention[0]!, read: true }] });
    const m = buildNeedsYouModel({ snapshotLanes: readLanes, liveDeadlines: { upcoming: [] }, liveBills: [] });
    const card = m.urgentCards.find((c) => c.email);
    expect(card).toBeTruthy();
    expect(card!.id).toBe("email:1");
    expect(card!.opened).toBe(true);
  });

  it("marks deadline cards completable (real completion) and bill cards not", () => {
    const m = buildNeedsYouModel({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: deadlines, liveBills: bills });
    expect(m.urgentCards.find((c) => c.id === "deadline:pr")!.completable).toBe(true);
    expect(m.urgentCards.find((c) => c.id === "bill:rent")!.completable).toBe(false);
  });

  it("Mark handled removes the email from BOTH the band and the inbox peek", () => {
    const base = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [] });
    const handledId = base.urgentCards.find((c) => c.email)!.id;
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [], handled: [handledId] });
    expect(m.urgentCards.find((c) => c.id === handledId)).toBeUndefined();
    expect(m.inboxRows.find((r) => r.id === handledId)).toBeUndefined();
  });

});
