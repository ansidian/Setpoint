import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlfredRunEvent } from "../../../shared/types/alfred";
import AlfredPanel from "./AlfredPanel";
import type { CalendarOpenRequest } from "../dashboard/dashboardShellModel";

let runs: Response[] = [];
let requests: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];

function scriptedRun(events: AlfredRunEvent[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
  runs.push(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
}

function deferredRun(events: AlfredRunEvent[]): { response: Response; finish: () => void } {
  const encoder = new TextEncoder();
  let closeStream = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      closeStream = () => {
        controller.enqueue(encoder.encode('event: run_end\ndata: {"type":"run_end","stop_reason":"end_turn"}\n\n'));
        controller.close();
      };
    },
  });
  return { response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }), finish: () => closeStream() };
}

beforeEach(() => {
  runs = [];
  requests = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input), "https://setpoint.test").pathname;
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ path, method: init.method ?? "GET", body });
    if (path === "/api/alfred/run") return runs.shift() ?? new Response(null, { status: 200 });
    if (path === "/api/alfred/email-context" && init.method === "POST") {
      const uid = String(body?.uid || "mail");
      return new Response(JSON.stringify({
        contextId: `ctx-${uid}`,
        uid,
        subject: body?.subject || "(No subject)",
        sender: {
          name: body?.senderName || "",
          address: body?.senderAddress || "",
          display: body?.senderName || body?.senderAddress || "Unknown sender",
        },
        timestamp: body?.timestamp || null,
        charCount: 120,
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (path === "/api/briefing/email/remote-content-trust") {
      return new Response(JSON.stringify([{
        id: 1,
        account_id: "gmail-work",
        account_label: "Work",
        account_email: "owner@example.com",
        sender_address: "bob@example.com",
        created_at: "2026-08-14T19:00:00Z",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (path.startsWith("/api/briefing/email/")) {
      return new Response(JSON.stringify({ body: "Body" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseProps = { open: true, onClose: () => {}, accent: "#cba6da", handoff: null, newChatTick: 0 };

describe("AlfredPanel", () => {

  it("submits the draft on Enter and renders the streamed answer", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "tool_start", tool_id: "t1", name: "get_upcoming_bills" },
      { type: "tool_result", tool_id: "t1", name: "get_upcoming_bills", ok: true, summary: "Bills · 1 upcoming" },
      { type: "rows", kind: "bill", items: [{ id: "b1", scheduleId: "s1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false, type: "bill", openActionDisabled: false }] },
      { type: "text_delta", text: "One bill is due. The rest can wait." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    render(<AlfredPanel {...baseProps} />);
    const input = screen.getByPlaceholderText("Ask across mail, calendar, and finances…");
    fireEvent.change(input, { target: { value: "Any bills?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("One bill is due.")).toBeTruthy());
    expect(screen.getByText("The rest can wait.")).toBeTruthy();
    // The tool chip is now tucked behind a "steps" disclosure, collapsed by default.
    expect(screen.queryByText("Bills · 1 upcoming")).toBeNull();
    const steps = screen.getByRole("button", { name: /1 step\b/ });
    fireEvent.click(steps);
    expect(screen.getByText("Bills · 1 upcoming")).toBeTruthy();
    expect(screen.getByText("Rent")).toBeTruthy();
    expect(screen.getByText("Any bills?")).toBeTruthy();
  });

  it("keeps Alfred open until Calendar accepts Review, performs zero writes on review, and uses normalized completion truth", async () => {
    let reviewRequest: CalendarOpenRequest | null = null;
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "calendar_proposal", proposal: {
        id: "proposal-1", revisionOf: null, title: "Project review", allDay: false,
        startDate: "2026-08-18", endDate: "2026-08-18", startTime: "15:00", endTime: "15:30",
        location: "Room 1", description: "Bring the notes.",
        source: { kind: "resolved", accountId: "account-1", calendarId: "primary", calendarName: "Personal" },
        duplicateCheckUnavailable: false, past: false,
      } },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    function Harness() {
      const [open, setOpen] = useState(true);
      return <>
        <AlfredPanel
          {...baseProps}
          open={open}
          onClose={() => setOpen(false)}
          onReviewCalendarProposal={(request) => { reviewRequest = request; }}
        />
        <output>{open ? "panel open" : "panel closed"}</output>
      </>;
    }
    render(<Harness />);
    const input = screen.getByPlaceholderText("Ask across mail, calendar, and finances…");
    fireEvent.change(input, { target: { value: "Schedule a project review" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("button", { name: "Review in Calendar" });

    fireEvent.click(screen.getByRole("button", { name: "Review in Calendar" }));
    expect(reviewRequest).toBeTruthy();
    expect(screen.getByText("panel open")).toBeTruthy();
    expect(requests.some((request) => request.path === "/api/calendar/events")).toBe(false);
    expect(reviewRequest!.options.eventCreateRequest?.seed).toMatchObject({
      title: "Project review",
      startDate: "2026-08-18",
      startTime: "15:00",
    });

    act(() => {
      reviewRequest!.options.eventCreateRequest?.onAcknowledged?.({
        status: "accepted",
        origin: { kind: "alfred-proposal", referenceId: "proposal-1" },
      });
    });
    expect(screen.getByText("panel closed")).toBeTruthy();

    act(() => {
      reviewRequest!.options.eventCreateRequest?.onCompleted?.({
        origin: { kind: "alfred-proposal", referenceId: "proposal-1" },
        event: {
          id: "event-1", title: "Edited project review", allDay: false,
          startMs: new Date("2026-08-18T23:00:00.000Z").getTime(),
          endMs: new Date("2026-08-18T23:30:00.000Z").getTime(),
          location: "Room 2", description: "Saved truth", calendarName: "Personal",
          accountId: "account-1", calendarId: "primary",
        } as never,
      });
    });
    expect(await screen.findByText("Created")).toBeTruthy();
    expect(screen.getByText("Edited project review")).toBeTruthy();
    expect(screen.getByText("Edited in Calendar")).toBeTruthy();
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/proposals/proposal-1/created"))).toBe(true));
  });

  it("stages and replaces an email without a model call, preserves the draft, then sends the replacement", async () => {
    const emailA = {
      id: "a",
      source: { uid: "mail-a", subject: "Email A", senderName: "Alice", senderAddress: "alice@example.com", timestamp: "2026-08-14T18:00:00Z" },
    };
    const emailB = {
      id: "b",
      source: { uid: "mail-b", accountId: "gmail-work", subject: "Email B", senderName: "Bob", senderAddress: "bob@example.com", timestamp: "2026-08-14T19:00:00Z" },
    };
    const { rerender } = render(<AlfredPanel {...baseProps} emailHandoff={emailA} />);

    await waitFor(() => expect(screen.getByTestId("alfred-pending-email-context").getAttribute("data-state")).toBe("ready"));
    const input = screen.getByPlaceholderText<HTMLInputElement>("Ask about this email…");
    fireEvent.change(input, { target: { value: "Does this need a reply?" } });
    expect(requests.filter((request) => request.path === "/api/alfred/run")).toHaveLength(0);

    rerender(<AlfredPanel {...baseProps} emailHandoff={emailB} />);
    await waitFor(() => expect(screen.getByText("Email B")).toBeTruthy());
    expect(input.value).toBe("Does this need a reply?");
    expect(screen.getByText("Attachment replaced—review your prompt")).toBeTruthy();
    expect(requests.filter((request) => request.path === "/api/alfred/run")).toHaveLength(0);

    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(requests.filter((request) => request.path === "/api/alfred/run")).toHaveLength(1));
    expect(requests.find((request) => request.path === "/api/alfred/run")?.body).toEqual({
      message: "Does this need a reply?",
      emailContextId: "ctx-mail-b",
    });
    expect(screen.getByRole("button", { name: /Preview email attachment: Email B/ })).toBeTruthy();
    expect(screen.queryByTestId("alfred-pending-email-context")).toBeNull();

    const preparationRequest = requests.find((request) => request.path === "/api/alfred/email-context" && request.body?.uid === "mail-b");
    expect(preparationRequest?.body).not.toHaveProperty("accountId");

    fireEvent.click(screen.getByRole("button", { name: /Preview email attachment: Email B/ }));
    await waitFor(() => expect(requests.some((request) => request.path === "/api/briefing/email/remote-content-trust")).toBe(true));
  });

  it("stages the first email handoff on the same click that lazy-mounts Alfred in Strict Mode", async () => {
    render(
      <StrictMode>
        <AlfredPanel {...baseProps} emailHandoff={{
          id: "first-click",
          source: {
            uid: "mail-first",
            subject: "First-click email",
            senderName: "Alice",
            senderAddress: "alice@example.com",
            timestamp: "2026-08-14T18:00:00Z",
          },
        }} />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("alfred-pending-email-context").getAttribute("data-state")).toBe("ready"));
    expect(requests.filter((request) => request.path === "/api/alfred/email-context")).toHaveLength(1);
    expect(requests.filter((request) => request.path === "/api/alfred/run")).toHaveLength(0);
  });

  it("prefills an attached-email suggestion without a model call until the owner sends the edited draft", async () => {
    render(<AlfredPanel {...baseProps} emailHandoff={{
      id: "suggestions",
      source: {
        uid: "mail-suggestions",
        subject: "Dinner reservation",
        senderName: "Bistro",
        senderAddress: "hello@bistro.example",
        timestamp: "2026-08-14T18:00:00Z",
      },
    }} />);

    await waitFor(() => expect(screen.getByText("Summarize this email")).toBeTruthy());
    expect(screen.getByText("Find related messages in my inbox")).toBeTruthy();
    expect(screen.queryByText("What's left today?")).toBeNull();

    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    fireEvent.click(screen.getByText("Summarize this email"));
    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message to Alfred" });
    expect(draft.value).toBe("Summarize this email");
    expect(requests.filter((request) => request.path === "/api/alfred/run")).toHaveLength(0);
    fireEvent.change(draft, { target: { value: "Summarize this email in two sentences" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message to Alfred" }));

    await waitFor(() => expect(requests.filter((request) => request.path === "/api/alfred/run")).toHaveLength(1));
    expect(requests.find((request) => request.path === "/api/alfred/run")?.body).toEqual({
      message: "Summarize this email in two sentences",
      emailContextId: "ctx-mail-suggestions",
    });
  });

  it("removes a staged email without clearing the draft or sending it", async () => {
    render(<AlfredPanel {...baseProps} emailHandoff={{
      id: "a",
      source: { uid: "mail-a", subject: "Email A", senderName: "Alice", senderAddress: "alice@example.com", timestamp: null },
    }} />);
    await waitFor(() => expect(screen.getByTestId("alfred-pending-email-context").getAttribute("data-state")).toBe("ready"));
    const input = screen.getByPlaceholderText<HTMLInputElement>("Ask about this email…");
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove attached email: Email A" }));

    expect(screen.queryByTestId("alfred-pending-email-context")).toBeNull();
    expect(screen.getByPlaceholderText<HTMLInputElement>("Ask across mail, calendar, and finances…").value).toBe("Keep this draft");
    expect(requests.filter((request) => request.path === "/api/alfred/run")).toHaveLength(0);
  });

  it("retries a handoff that arrived during an in-flight run instead of dropping it (P2-3)", async () => {
    const pending = deferredRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
    ]);
    runs.push(pending.response);
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "run_end", stop_reason: "end_turn" },
    ]);

    const { rerender } = render(<AlfredPanel {...baseProps} handoff={null} />);
    rerender(<AlfredPanel {...baseProps} handoff={{ id: "h1", query: "first handoff" }} />);
    await waitFor(() => expect(screen.getByText("first handoff")).toBeTruthy());

    // A second handoff arrives while the first run is still streaming (busy).
    rerender(<AlfredPanel {...baseProps} handoff={{ id: "h2", query: "second handoff" }} />);
    expect(screen.queryByText("second handoff")).toBeNull();

    // When the first run finishes, the dropped handoff must fire — not vanish.
    pending.finish();
    await waitFor(() => expect(screen.getByText("second handoff")).toBeTruthy());
  });

  it("clears the conversation when newChatTick changes", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "text_delta", text: "Hello." },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    const { rerender } = render(<AlfredPanel {...baseProps} />);
    const input = screen.getByPlaceholderText("Ask across mail, calendar, and finances…");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Hello.")).toBeTruthy());
    fireEvent.change(input, { target: { value: "half-typed follow-up" } });

    rerender(<AlfredPanel {...baseProps} newChatTick={1} />);
    await waitFor(() => expect(screen.queryByText("Hello.")).toBeNull());
    expect(screen.getByText("What would you like to connect?")).toBeTruthy();
    expect(screen.getByPlaceholderText<HTMLInputElement>("Ask across mail, calendar, and finances…").value).toBe("");
  });

  it("Escape closes the preview first, then the panel", async () => {
    scriptedRun([
      { type: "run_start", conversation_id: "c1", provider: "anthropic", model: "claude-sonnet-4-6" },
      { type: "rows", kind: "email", items: [{ uid: "m1", subject: "Verify enrollment", from: { name: "Financial Aid" }, email_date: "2026-06-12T17:30:00.000Z" }] },
      { type: "run_end", stop_reason: "end_turn" },
    ]);
    function Harness() {
      const [open, setOpen] = useState(true);
      return <><AlfredPanel {...baseProps} open={open} onClose={() => setOpen(false)} /><output>{open ? "panel open" : "panel closed"}</output></>;
    }
    render(<Harness />);
    const input = screen.getByPlaceholderText("Ask across mail, calendar, and finances…");
    fireEvent.change(input, { target: { value: "find it" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Verify enrollment")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Verify enrollment/ }));
    expect(screen.getByRole("dialog", { name: "Email preview" })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Email preview" })).toBeNull();
    expect(screen.getByText("panel open")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByText("panel closed")).toBeTruthy();
  });
});
