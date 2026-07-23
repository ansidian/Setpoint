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

describe("buildNeedsYouModel count + color", () => {
  it("counts urgent emails + overdue/due-today deadlines + due-today unpaid bills, rose when anything overdue", () => {
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills });
    expect(m.countN).toBe(5);
    expect(m.countColor).toBe("var(--sp-rose)");
  });

  it("uses accent color when nothing is overdue", () => {
    const noOverdue = { upcoming: deadlines.upcoming.filter((d) => d.id !== "pr") };
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: noOverdue, liveBills: bills });
    expect(m.countColor).toBe("var(--sp-accent)");
  });

  it("is empty (count 0, accent) when no urgent items", () => {
    const m = buildNeedsYouModel({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(m.countN).toBe(0);
    expect(m.countColor).toBe("var(--sp-accent)");
    expect(m.urgentCards).toEqual([]);
  });
});

describe("buildNeedsYouModel breakdown + cards", () => {
  it("builds colored breakdown segments: N overdue (rose) · N due today (rose) · N urgent emails (cream)", () => {
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: deadlines, liveBills: bills });
    expect(m.breakdown).toEqual([
      { text: "1 overdue", color: "var(--sp-rose)" },
      { text: "2 due today", color: "var(--sp-rose)" },
      { text: "2 urgent emails", color: "var(--sp-cream)" },
    ]);
  });

  it("singularizes the email segment", () => {
    const oneEmail = lanes({ needs_attention: [lanes().needs_attention[0]!] });
    const m = buildNeedsYouModel({ snapshotLanes: oneEmail, liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(m.breakdown).toEqual([{ text: "1 urgent email", color: "var(--sp-cream)" }]);
  });

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
    expect(m.backfillCards[0]!).toMatchObject({ kind: "backfill", source: "Coming up", sourceIcon: "Clock" });
    expect(m.backfillCards[0]!.pill.tone).toBe("var(--sp-cream)");
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
    expect(m.moreLabel).toBe("more item needs you");
    expect(m.backfillCards).toEqual([]);
  });
});

describe("buildNeedsYouModel due-today time on deadline pills", () => {
  const onlyDeadline = (d: NeedsYouDeadline) =>
    buildNeedsYouModel({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: { upcoming: [d] }, liveBills: [] });

  it("appends the due time after 'Due today' when a due-today deadline has one", () => {
    const m = onlyDeadline({ id: "demolink", title: "Send portfolio demo link", due_date: "2026-06-19", due_time: "2:00 PM", status: "open", priority: 2, class_name: "Career" });
    expect(m.urgentCards.find((c) => c.id === "deadline:demolink")!.pill.label).toBe("Due today, 2:00 PM");
  });

  it("keeps a bare 'Due today' when the due-today deadline has no time", () => {
    const m = onlyDeadline({ id: "demolink", title: "Send portfolio demo link", due_date: "2026-06-19", status: "open", priority: 2, class_name: "Career" });
    expect(m.urgentCards.find((c) => c.id === "deadline:demolink")!.pill.label).toBe("Due today");
  });

  it("never appends time to an overdue deadline (keeps the 'N days overdue' label)", () => {
    const m = onlyDeadline({ id: "pr", title: "Respond to PR review", due_date: "2026-06-18", due_time: "2:00 PM", status: "open", priority: 1, class_name: "Engineering" });
    expect(m.urgentCards.find((c) => c.id === "deadline:pr")!.pill.label).toBe("1 day overdue");
  });
});

describe("buildNeedsYouModel chip tooltips", () => {
  it("gives urgent + backfill cards an absolute chipTooltip (Today+time / short date)", () => {
    const dl = {
      upcoming: [
        { id: "pr", title: "PR", due_date: "2026-06-18", status: "open", priority: 1, class_name: "Eng" }, // overdue
        { id: "demolink", title: "Demo", due_date: "2026-06-19", due_time: "2:00 PM", status: "open", priority: 2, class_name: "Career" }, // today
        { id: "later", title: "Later", due_date: "2026-06-22", status: "open", priority: 2, class_name: "Port" }, // backfill
      ],
    };
    const bl = [
      { id: "rent", name: "Rent", amount: 2450, next_date: "2026-06-19", paid: false }, // today
      { id: "electric", name: "Electric", amount: 100, next_date: "2026-06-23", paid: false }, // backfill
    ];
    const m = buildNeedsYouModel({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: dl, liveBills: bl });
    const urgent = Object.fromEntries(m.urgentCards.map((c) => [c.id, c.chipTooltip]));
    const backfill = Object.fromEntries(m.backfillCards.map((c) => [c.id, c.chipTooltip]));
    expect(urgent["deadline:pr"]).toBe("6/18/26");      // overdue → short date
    expect(urgent["deadline:demolink"]).toBeNull();     // due today → chip already says it
    expect(urgent["bill:rent"]).toBeNull();             // due today → no tooltip
    expect(backfill["deadline:later"]).toBe("6/22/26");
    expect(backfill["bill:electric"]).toBe("6/23/26");
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

  it("returns an empty set when there is no server data", () => {
    const ids = collectNeedsYouCandidateIds({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(ids.size).toBe(0);
  });
});

describe("buildNeedsYouModel email open/handled transitions + inbox rows", () => {
  it("Open (mark-read) flips the card to opened: MailOpen icon, 'opened, no reply yet' meta, STAYS in band", () => {
    const base = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [] });
    const openedEmailId = base.urgentCards.find((c) => c.email)!.id;
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [], opened: [openedEmailId] });
    const card = m.urgentCards.find((c) => c.id === openedEmailId);
    expect(card).toBeTruthy();
    expect(card!.opened).toBe(true);
    expect(card!.sourceIcon).toBe("MailOpen");
    expect(card!.meta).toContain("opened, no reply yet");
  });

  it("keeps a READ but unhandled needs-attention email in the band — reading alone does not clear it", () => {
    const readLanes = lanes({ needs_attention: [{ ...lanes().needs_attention[0]!, read: true }] });
    const m = buildNeedsYouModel({ snapshotLanes: readLanes, liveDeadlines: { upcoming: [] }, liveBills: [] });
    const card = m.urgentCards.find((c) => c.email);
    expect(card).toBeTruthy();
    expect(card!.id).toBe("email:1");
    expect(card!.opened).toBe(true);          // read reflects as opened…
    expect(card!.sourceIcon).toBe("MailOpen"); // …but it STAYS in the band
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

  it("inbox rows mirror the band lane: needs=rose solid dot, fyi=cyan solid dot, opened=hollow", () => {
    const openedId = "email:1";
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [], opened: [openedId] });
    const r1 = m.inboxRows.find((r) => r.id === "email:1");
    const fyi = m.inboxRows.find((r) => r.id === "email:3");
    expect(r1).toMatchObject({ lane: "needs_attention", dotTone: "var(--sp-rose)", dotState: "hollow" });
    expect(fyi).toMatchObject({ lane: "fyi", dotTone: "var(--sp-cyan)", dotState: "solid" });
    expect(r1!.label).toBe("Riley Park · PR blocker: source retry copy");
  });

  it("inboxChip is 'N need you' (rose) when needs rows remain, else calm green", () => {
    const m = buildNeedsYouModel({ snapshotLanes: lanes(), liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(m.inboxChip).toMatchObject({ text: "2 need you", tone: "var(--sp-rose)", calm: false });
    const calm = buildNeedsYouModel({ snapshotLanes: { needs_attention: [], fyi: [], carryover: [] }, liveDeadlines: { upcoming: [] }, liveBills: [] });
    expect(calm.inboxChip).toMatchObject({ text: "Inbox calm", tone: "var(--sp-green)", calm: true });
  });
});
