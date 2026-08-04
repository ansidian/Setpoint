import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Activity, useState } from "react";
import Reader from "./Reader";

// test-architecture: allow-boundary-mock -- Reader, AddTaskPanel, body loading, and bill resolution run together while authenticated HTTP/provider responses are deterministic.
vi.mock("../../../api", async () => {
  const actual = await vi.importActual("../../../api");
  return {
    ...actual,
    getEmailBody: vi.fn().mockResolvedValue({ body: "Loaded email body" }),
    peekEmailBody: vi.fn(() => null),
    resolveBillPaySeed: vi.fn().mockResolvedValue({ bill: null, mapping: null, actualStatus: null }),
    getTodoistProjects: vi.fn().mockResolvedValue([]),
    getTodoistLabels: vi.fn().mockResolvedValue([]),
    listReminders: vi.fn().mockResolvedValue({ reminders: [] }),
    createDeadline: vi.fn().mockResolvedValue({ id: "new-task", title: "Renew", due_date: "2126-08-03" }),
    createReminder: vi.fn().mockResolvedValue({}),
  };
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Harness({ mobile = false }: { mobile?: boolean }) {
  const [billOpen, setBillOpen] = useState(false);
  return <Reader
    email={{ id: "mail-1", uid: "gmail-work-abc", account_id: "work", account_email: "me@example.test", subject: "Renew coverage", from: "Agent", fromEmail: "agent@example.test", summary: "Coverage expires.", action: "Submit renewal", deadline_at: "2126-08-03", hasBill: true, _activeSnapshot: true, _lane: "needs_attention" }}
    account={{ name: "Work" }} accent="#cba6da" onAction={() => {}} onClose={() => {}}
    showTriage={false} showDraft={false} billOpen={billOpen} setBillOpen={setBillOpen} isMobile={mobile}
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

  it("toggles the desktop reminder rail closed and keeps its exit shell inert", () => {
    render(<Harness />);
    const reminderButton = screen.getByRole("button", { name: "Remind me" });

    fireEvent.click(reminderButton);
    expect(screen.getByRole("button", { name: "Hide reminder" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(reminderButton);

    const drawer = screen.getByTestId("inbox-remind-workspace");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(drawer.hasAttribute("inert")).toBe(true);
    expect(drawer.style.pointerEvents).toBe("none");
  });

  it("opens AddTaskPanel with the floating host on mobile", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    render(<Harness mobile />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(within(screen.getByTestId("inbox-mobile-actions-menu")).getByRole("button", { name: "Remind me" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Task title")).toBeTruthy();
  });

  it("delegates dirty Cancel confirmation to the editor while still guarding competing bill actions", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
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
    fireEvent.click(screen.getByRole("button", { name: /pay bill/i }));
    expect(screen.getByLabelText("Task title")).toBeTruthy();
    expect(screen.getByTestId("inbox-remind-workspace").getAttribute("aria-hidden")).toBe("false");
  });

  it("closes after success and announces without mutating email lifecycle", async () => {
    function SuccessHarness() {
      const [billOpen, setBillOpen] = useState(false);
      return <Reader email={{ id: "mail-1", subject: "Renew", action: "Renew", deadline_at: "2126-08-03" }} accent="#cba6da" onAction={() => {}} onClose={() => {}} showTriage={false} showDraft={false} billOpen={billOpen} setBillOpen={setBillOpen} />;
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
