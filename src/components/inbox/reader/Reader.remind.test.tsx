import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity } from "react";
import Reader from "./Reader";

// test-architecture: allow-boundary-mock -- Reader, AddTaskPanel, and body loading run together while authenticated HTTP/provider responses are deterministic.
vi.mock("../../../api", async () => {
  const actual = await vi.importActual("../../../api");
  return {
    ...actual,
    getEmailBody: vi.fn().mockResolvedValue({ body: "Loaded email body" }),
    peekEmailBody: vi.fn(() => null),
    getTodoistProjects: vi.fn().mockResolvedValue([]),
    getTodoistLabels: vi.fn().mockResolvedValue([]),
    listReminders: vi.fn().mockResolvedValue({ reminders: [] }),
    createDeadline: vi.fn().mockResolvedValue({ id: "new-task", title: "Renew", due_date: "2126-08-03" }),
    createReminder: vi.fn().mockResolvedValue({}),
  };
});

beforeEach(() => {
  // jsdom has no layout observer; the real notes field still mounts with Reader.
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Harness({ mobile = false }: { mobile?: boolean }) {
  return <Reader
    email={{ id: "mail-1", uid: "gmail-work-abc", account_id: "work", account_email: "me@example.test", subject: "Renew coverage", from: "Agent", fromEmail: "agent@example.test", summary: "Coverage expires.", action: "Submit renewal", deadline_at: "2126-08-03", _activeSnapshot: true, _lane: "needs_attention" }}
    account={{ name: "Work" }} accent="#cba6da" onAction={() => {}} onClose={() => {}}
    showTriage={false} showDraft={false} isMobile={mobile}
  />;
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

  it("delegates dirty Cancel confirmation to the editor", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Changed renewal" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getByTestId("inbox-remind-workspace").getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(screen.queryByLabelText("Task title")).toBeNull());
  });

  it("closes after success and announces without mutating email lifecycle", async () => {
    function SuccessHarness() {
      return <Reader email={{ id: "mail-1", subject: "Renew", action: "Renew", deadline_at: "2126-08-03" }} accent="#cba6da" onAction={() => {}} onClose={() => {}} showTriage={false} showDraft={false} />;
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
