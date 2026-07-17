// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import Reader from "./Reader";
import type { AddTaskPanelProps } from "../../todoist/add-task-panel/types";

const panelProps = vi.hoisted(() => ({ current: null as AddTaskPanelProps | null }));
vi.mock("../../todoist/AddTaskPanel", () => ({
  default: (props: AddTaskPanelProps) => {
    panelProps.current = props;
    return <div data-testid="fake-task-panel">
      <button onClick={() => props.onDirtyChange?.(true)}>Dirty task</button>
      <button onClick={props.onClose}>Close task</button>
      <button onClick={() => props.onTaskAdded?.({ id: "new-task", title: "Renew", due_date: "2026-08-01" })}>Save task</button>
    </div>;
  },
}));
vi.mock("./useEmailBody", () => ({ default: () => ({ loading: true, body: null, error: null, source: "loading" }) }));
vi.mock("./useBillPayResolver", () => ({ default: () => ({ key: null, status: "idle", resolvedBill: null, mapping: null, actualStatus: null, error: null }) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); panelProps.current = null; });

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
    expect(panelProps.current).toMatchObject({ host: "inline", initialInput: "Submit renewal", requireDue: true });
    expect(panelProps.current?.initialDescription).toContain("Coverage expires.\n\nFrom: Agent <agent@example.test>");
    expect(panelProps.current?.initialDescription).toContain("https://mail.google.com/mail/");
  });

  it("opens the shared editor as a mobile sheet", () => {
    render(<Harness mobile />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(within(screen.getByTestId("inbox-mobile-actions-menu")).getByRole("button", { name: "Remind me" }));
    expect(screen.getByTestId("fake-task-panel")).toBeTruthy();
    expect(panelProps.current?.host).toBe("floating");
  });

  it("delegates dirty Cancel confirmation to the editor while still guarding competing bill actions", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    expect(panelProps.current?.confirmDirtyCloseInline).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Dirty task" }));
    fireEvent.click(screen.getByRole("button", { name: "Close task" }));
    expect(screen.queryByTestId("fake-task-panel")).toBeNull();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    fireEvent.click(screen.getByRole("button", { name: "Dirty task" }));
    fireEvent.click(screen.getByRole("button", { name: /pay bill/i }));
    expect(screen.getByTestId("fake-task-panel")).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("closes after success and announces without mutating email lifecycle", () => {
    const onAction = vi.fn();
    function SuccessHarness() {
      const [billOpen, setBillOpen] = useState(false);
      return <Reader email={{ id: "mail-1", subject: "Renew", action: "Renew", deadline_at: "2126-08-03" }} accent="#cba6da" onAction={onAction} onClose={() => {}} showTriage={false} showDraft={false} billOpen={billOpen} setBillOpen={setBillOpen} />;
    }
    render(<SuccessHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));
    expect(screen.queryByTestId("fake-task-panel")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Reminder added");
    expect(onAction).not.toHaveBeenCalled();
  });
});
