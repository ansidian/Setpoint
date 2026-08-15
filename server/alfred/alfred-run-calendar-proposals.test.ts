import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAlfred } from "./alfred-run.ts";
import { clearAlfredConversations, createAlfredConversation } from "./alfred-conversations.ts";
import type { AlfredRunEvent } from "../../shared/types/alfred.ts";
import type { AlfredDependencies, AlfredFetch, AlfredUsageRecorder } from "./alfred-types.ts";

type SseTestEvent = Record<string, unknown> & { type: string };

function sseBody(events: SseTestEvent[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return (async function* generate() {
    for (const event of events) yield encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }());
}

function textTurn(text: string): SseTestEvent[] {
  return [
    { type: "message_start", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 5 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ];
}

function toolUseTurn(input: Record<string, unknown>): SseTestEvent[] {
  return [
    { type: "message_start", message: { model: "claude-sonnet-4-6", usage: { input_tokens: 5 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "propose_calendar_event" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ];
}

function dependencies(overrides: Partial<AlfredDependencies> = {}): AlfredDependencies {
  return overrides as AlfredDependencies;
}

describe("runAlfred calendar proposal commit boundary", () => {
  let events: AlfredRunEvent[];
  let usageRows: Parameters<AlfredUsageRecorder>[1][];
  let recordUsage: AlfredUsageRecorder;

  beforeEach(() => {
    clearAlfredConversations();
    events = [];
    usageRows = [];
    recordUsage = async (_userId, row) => { usageRows.push(row); };
  });

  it("commits and emits one staged proposal only immediately before successful run_end", async () => {
    const turns = [toolUseTurn({
      owner_instruction: "Schedule a project review on August 18",
      title: "Project review",
      all_day: false,
      start_date: "2026-08-18",
      start_time: "15:00",
    }), textTurn("The proposal is ready for Calendar review.")];
    let call = 0;
    const fetchImpl = vi.fn<AlfredFetch>(async () => ({
      ok: true, status: 200, text: async () => "", body: sseBody(turns[call++] || []),
    }));
    const conversation = createAlfredConversation({ now: 0 });
    const deps = dependencies({
      loadUserConfig: vi.fn().mockResolvedValue({
        accounts: [{ id: "account-1", email: "owner@example.com", type: "gmail", calendar_enabled: true }],
      }),
      getCalendarSourceGroups: vi.fn().mockResolvedValue([{
        accountId: "account-1",
        calendars: [{ id: "primary", summary: "Personal", writable: true, primary: true }],
      }]),
      fetchCalendar: vi.fn().mockResolvedValue([]),
      pacificDayBoundaries: vi.fn((date: Date) => ({ dayStart: date, dayEnd: date })),
    });

    await runAlfred({
      userId: "user-1", conversation, message: "Schedule a project review on August 18",
      emit: (event) => { events.push(event); },
      fetchImpl, apiKey: "key", deps, recordUsage,
      now: () => new Date("2026-08-15T19:00:00.000Z"),
    });

    expect(events.map((event) => event.type)).toEqual([
      "tool_start", "tool_result", "text_delta", "calendar_proposal", "run_end",
    ]);
    const proposalEvent = events.find(
      (event): event is Extract<AlfredRunEvent, { type: "calendar_proposal" }> => event.type === "calendar_proposal",
    )!;
    expect(proposalEvent.proposal).toMatchObject({ title: "Project review", endTime: "15:30" });
    expect(conversation.calendarProposalState.activeProposalId).toBe(proposalEvent.proposal.id);
    expect(conversation.trustedOwnerTurns).toMatchObject([{ consumed: true }]);
    expect(JSON.stringify(usageRows)).not.toContain("Project review");
    expect(JSON.stringify(usageRows)).not.toContain(String(proposalEvent.proposal.id));
  });

  it("drops staging and preserves proposal state when the provider fails", async () => {
    let call = 0;
    const fetchImpl = vi.fn<AlfredFetch>(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true, status: 200, text: async () => "",
          body: sseBody(toolUseTurn({
            owner_instruction: "Schedule a project review on August 18",
            title: "Project review", all_day: false, start_date: "2026-08-18", start_time: "15:00",
          })),
        };
      }
      return { ok: false, status: 529, text: async () => "overloaded" };
    });
    const conversation = createAlfredConversation({ now: 0 });
    const deps = dependencies({
      loadUserConfig: vi.fn().mockResolvedValue({ accounts: [] }),
      getCalendarSourceGroups: vi.fn().mockResolvedValue([]),
    });

    await expect(runAlfred({
      userId: "user-1", conversation, message: "Schedule a project review on August 18",
      emit: (event) => { events.push(event); },
      fetchImpl, apiKey: "key", deps, recordUsage,
      now: () => new Date("2026-08-15T19:00:00.000Z"),
    })).rejects.toThrow("Anthropic API error (529)");

    expect(events.some((event) => event.type === "calendar_proposal")).toBe(false);
    expect(conversation.calendarProposalState.activeProposalId).toBeNull();
    expect(conversation.calendarProposalState.proposals.size).toBe(0);
    expect(conversation.trustedOwnerTurns).toEqual([]);
  });

  it("commits an all-day proposal after the model clears rejected time fields", async () => {
    const turns = [
      toolUseTurn({
        owner_instruction: "Schedule this in my calendar",
        title: "DigitalOcean invoice notice",
        all_day: true,
        start_date: "2026-08-01",
        start_time: "09:00",
        end_time: "10:00",
      }),
      toolUseTurn({
        owner_instruction: "Schedule this in my calendar",
        title: "DigitalOcean invoice notice",
        all_day: true,
        start_date: "2026-08-01",
        start_time: "",
        end_time: "",
      }),
      textTurn("The proposal is ready for Calendar review."),
    ];
    let call = 0;
    const fetchImpl = vi.fn<AlfredFetch>(async () => ({
      ok: true, status: 200, text: async () => "", body: sseBody(turns[call++] || []),
    }));
    const conversation = createAlfredConversation({ now: 0 });
    const emitted: AlfredRunEvent[] = [];

    await runAlfred({
      userId: "user-1", conversation, message: "Schedule this in my calendar",
      emit: (event) => { emitted.push(event); }, fetchImpl, apiKey: "key",
      deps: dependencies({ loadUserConfig: vi.fn().mockResolvedValue({ accounts: [] }) }),
      recordUsage, now: () => new Date("2026-08-15T19:00:00.000Z"),
    });

    expect(emitted.filter((event) => event.type === "tool_result").map((event) => event.ok)).toEqual([false, true]);
    expect(emitted.find((event) => event.type === "calendar_proposal")).toMatchObject({
      proposal: {
        title: "DigitalOcean invoice notice",
        allDay: true,
        startDate: "2026-08-01",
        startTime: null,
        endTime: null,
      },
    });
  });

  it("carries an explicit schedule request through one clarification answer", async () => {
    const conversation = createAlfredConversation({ now: 0 });
    const deps = dependencies({
      loadUserConfig: vi.fn().mockResolvedValue({
        accounts: [{ id: "account-1", email: "owner@example.com", type: "gmail", calendar_enabled: true }],
      }),
      getCalendarSourceGroups: vi.fn().mockResolvedValue([{
        accountId: "account-1",
        calendars: [{ id: "primary", summary: "Personal", writable: true, primary: true }],
      }]),
      fetchCalendar: vi.fn().mockResolvedValue([]),
      pacificDayBoundaries: vi.fn((date: Date) => ({ dayStart: date, dayEnd: date })),
    });
    const firstFetch = vi.fn<AlfredFetch>(async () => ({
      ok: true, status: 200, text: async () => "",
      body: sseBody(textTurn("What title, date, and Pacific-time start time should I use?")),
    }));

    await runAlfred({
      userId: "user-1", conversation, message: "Schedule this in my calendar",
      emit: () => {}, fetchImpl: firstFetch, apiKey: "key", deps, recordUsage,
      now: () => new Date("2026-08-15T19:00:00.000Z"),
    });

    const turns = [toolUseTurn({
      owner_instruction: "Schedule this in my calendar",
      title: "Test Event",
      all_day: false,
      start_date: "2026-08-15",
      start_time: "15:00",
      end_time: "16:00",
    }), textTurn("The proposal is ready for Calendar review.")];
    let call = 0;
    const secondFetch = vi.fn<AlfredFetch>(async () => ({
      ok: true, status: 200, text: async () => "", body: sseBody(turns[call++] || []),
    }));
    const secondEvents: AlfredRunEvent[] = [];

    await runAlfred({
      userId: "user-1", conversation, message: "Test Event, today 3–4pm",
      emit: (event) => { secondEvents.push(event); },
      fetchImpl: secondFetch, apiKey: "key", deps, recordUsage,
      now: () => new Date("2026-08-15T19:00:00.000Z"),
    });

    expect(secondEvents.some((event) => event.type === "calendar_proposal")).toBe(true);
    expect(conversation.trustedOwnerTurns[0]).toMatchObject({
      message: "Schedule this in my calendar",
      consumed: true,
    });
  });
});
