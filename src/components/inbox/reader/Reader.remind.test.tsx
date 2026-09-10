import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Activity } from "react";
import { MemoryRouter, useLocation } from "react-router";
import Reader from "./Reader";

// test-architecture: allow-boundary-mock -- Reader, AddTaskPanel, body loading, and bill resolution run together while authenticated HTTP/provider responses are deterministic.
vi.mock("../../../api", async () => {
  const actual = await vi.importActual("../../../api");
  return {
    ...actual,
    getEmailBody: vi.fn().mockResolvedValue({ body: "Loaded email body" }),
    peekEmailBody: vi.fn(() => null),
    resolveFinancialEmailPlan: vi.fn().mockResolvedValue({
      version: 1,
      candidate: {},
      classification: { documentKind: "informational", eventKind: null, confidence: 1, reasons: ["informational_event"] },
      operation: { intended: "no_write", kind: "no_write", reasons: ["informational_event"] },
      targets: {},
      reconciliation: { status: "not_checked", disposition: "no_write" },
      reviewReasons: [],
      automation: { eligible: false, gates: [], reasons: ["informational_event"] },
    }),
    getTodoistProjects: vi.fn().mockResolvedValue([]),
    getTodoistLabels: vi.fn().mockResolvedValue([]),
    listReminders: vi.fn().mockResolvedValue({ reminders: [] }),
    createDeadline: vi.fn().mockResolvedValue({ id: "new-task", title: "Renew", due_date: "2126-08-03" }),
    createReminder: vi.fn().mockResolvedValue({}),
  };
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function CurrentRoute() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

function Harness({ mobile = false, uid = "gmail-work-abc" }: { mobile?: boolean; uid?: string }) {
  return <MemoryRouter><CurrentRoute /><Reader
    email={{ id: "mail-1", uid, account_id: "work", account_email: "me@example.test", subject: "Renew coverage", from: "Agent", fromEmail: "agent@example.test", summary: "Coverage expires.", action: "Submit renewal", deadline_at: "2126-08-03", hasBill: true, bill_candidate: { event_kind: "bill_issued" }, _activeSnapshot: true, _lane: "needs_attention" }}
    account={{ name: "Work" }} accent="#cba6da" onAction={() => {}} onClose={() => {}}
    showTriage={false} showDraft={false} isMobile={mobile}
  /></MemoryRouter>;
}

describe("Inbox Remind me workspace", () => {
  it("opens the desktop reader rail synchronously from persisted triage while body loading continues", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    expect(screen.getByTestId("inbox-remind-workspace")).toBeTruthy();
    expect((screen.getByLabelText("Task title") as HTMLInputElement).value).toBe("Submit renewal");
    expect((screen.getByLabelText("Task description") as HTMLTextAreaElement).value).toContain("Coverage expires.\n\nFrom: Agent <agent@example.test>");
    expect((screen.getByLabelText("Task description") as HTMLTextAreaElement).value).toContain("https://mail.google.com/mail/");
  });



  it("delegates dirty Cancel confirmation to the editor while guarding a Create profile navigation", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Changed renewal" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getByTestId("inbox-remind-workspace").getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(screen.queryByLabelText("Task title")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    await waitFor(() => expect(screen.getByTestId("inbox-remind-workspace").getAttribute("aria-hidden")).toBe("false"));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Changed again" } });
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Current route").textContent).toBe("/");
    expect(screen.getByLabelText("Task title")).toBeTruthy();
    expect((screen.getByLabelText("Task title") as HTMLInputElement).value).toBe("Changed again");
    expect(screen.getByTestId("inbox-remind-workspace").getAttribute("aria-hidden")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByLabelText("Current route").textContent).toBe("/");
    expect((screen.getByLabelText("Task title") as HTMLInputElement).value).toBe("Changed again");
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.getByLabelText("Current route").textContent).toBe("/settings"));
  });

  it("clears a deferred profile navigation when the reader is hidden or its email changes", () => {
    const { rerender } = render(<Activity mode="visible"><Harness /></Activity>);
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Keep this reminder draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    rerender(<Activity mode="hidden"><Harness /></Activity>);
    rerender(<Activity mode="visible"><Harness /></Activity>);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Current route").textContent).toBe("/");
    expect((screen.getByLabelText("Task title") as HTMLInputElement).value).toBe("Keep this reminder draft");
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    rerender(<Activity mode="visible"><Harness uid="gmail-other-source" /></Activity>);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Current route").textContent).toBe("/");
  });

  it("closes after success and announces without mutating email lifecycle", async () => {
    function SuccessHarness() {
      return <MemoryRouter><Reader email={{ id: "mail-1", subject: "Renew", action: "Renew", deadline_at: "2126-08-03" }} accent="#cba6da" onAction={() => {}} onClose={() => {}} showTriage={false} showDraft={false} /></MemoryRouter>;
    }
    render(<SuccessHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(screen.getByTestId("inbox-remind-workspace").getAttribute("aria-hidden")).toBe("true"));
    expect(await screen.findByText("Reminder added")).toBeTruthy();
  });

  it("dismisses the reminder toast when the inbox view is hidden", async () => {
    const { rerender } = render(
      <Activity mode="visible">
        <Harness />
      </Activity>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(await screen.findByText("Reminder added")).toBeTruthy();

    rerender(
      <Activity mode="hidden">
        <Harness />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Harness />
      </Activity>,
    );

    expect(screen.queryByText("Reminder added")).toBeNull();
  });
});
