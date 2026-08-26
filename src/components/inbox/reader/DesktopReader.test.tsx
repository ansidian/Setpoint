import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Fragment, useState } from "react";
import type { ComponentProps, SetStateAction } from "react";
import DesktopReader from "./DesktopReader";
import { shouldSuspendInboxHotkeys } from "../inboxHotkeys";
import type { InboxEmailLike } from "../inboxTypes";
import { IDLE_BILL_RESOLUTION } from "./readerTypes";
import type { BillResolutionState } from "./readerTypes";

afterEach(() => {
  cleanup();
});

type DesktopReaderOverrides = Omit<Partial<ComponentProps<typeof DesktopReader>>, "email" | "billResolution"> & {
  email?: Partial<InboxEmailLike>;
  billResolution?: Partial<BillResolutionState>;
};

function renderReader(overrides: DesktopReaderOverrides = {}) {
  const onAction = vi.fn();
  function ReaderHarness() {
    const [snoozeOpen, setSnoozeOpen] = useState(overrides.snoozeOpen ?? false);
    const [billOpen, setBillOpen] = useState(overrides.billOpen ?? false);
    const [drafting, setDrafting] = useState(overrides.drafting ?? false);
    const [openedBill, setOpenedBill] = useState("");
    const updateSnooze = (value: SetStateAction<boolean>) => {
      setSnoozeOpen(value);
      overrides.setSnoozeOpen?.(value);
    };
    return <Fragment><output aria-label="Opened recorded bill">{openedBill}</output><output aria-label="Bill drawer state">{billOpen ? "open" : "closed"}</output><output aria-label="Draft state">{drafting ? "open" : "closed"}</output><DesktopReader
      email={{
        id: "msg-1",
        uid: "msg-1",
        subject: "Action needed",
        from: "Sender",
        fromEmail: "sender@example.test",
        date: "2026-05-03T15:00:00.000Z",
        _activeSnapshot: true,
        snapshot_item_id: 42,
        _lane: "needs_attention",
        ...overrides.email,
      }}
      account={{ name: "Work", color: "#cba6da" }}
      accent="#cba6da"
      onAction={onAction}
      onClose={() => {}}
      showTriage={false}
      showDraft={overrides.showDraft || false}
      billOpen={billOpen}
      billMounted={overrides.billMounted || false}
      setBillOpen={overrides.setBillOpen || setBillOpen}
      onOpenRecordedBill={overrides.onOpenRecordedBill || ((target) => setOpenedBill(JSON.stringify(target)))}
      snoozeOpen={snoozeOpen}
      setSnoozeOpen={updateSnooze}
      bodyState={overrides.bodyState || { loading: false, error: null, body: "", source: "loaded" }}
      billResolution={overrides.billResolution ? { ...IDLE_BILL_RESOLUTION, ...overrides.billResolution } : undefined}
      drafting={drafting}
      setDrafting={overrides.setDrafting || setDrafting}
      readOnly={overrides.readOnly || false}
      onRemind={overrides.onRemind}
      onAskAlfred={overrides.onAskAlfred}
    /></Fragment>;
  }
  render(<ReaderHarness />);
  return { onAction };
}

function openMoveMenu() {
  const trigger = screen.getByRole("button", { name: /move to/i });
  fireEvent.click(trigger);
  return {
    trigger,
    menu: screen.getByRole("menu", { name: /move email/i }),
  };
}

function openTriageMenu() {
  const trigger = screen.getByRole("button", { name: /^triage$/i });
  fireEvent.click(trigger);
  return {
    trigger,
    menu: screen.getByRole("menu", { name: /triage email/i }),
  };
}

describe("DesktopReader snapshot actions", () => {
  it("places loaded attachments above the desktop email body", () => {
    renderReader({
      bodyState: {
        loading: false,
        error: null,
        body: "Body",
        source: "loaded",
        attachments: [{ id: "2", filename: "report.pdf", contentType: "application/pdf", inline: false }],
      },
    });

    expect(screen.getByLabelText("1 email attachment")).toBeTruthy();
  });

  it("closes grouped menus after dispatch and restores focus to the trigger", () => {
    renderReader();
    const { trigger, menu } = openMoveMenu();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /^fyi$/i }));

    expect(screen.queryByRole("menu", { name: /move email/i })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("supports arrow navigation and predictable Escape dismissal", async () => {
    renderReader();
    const { trigger, menu } = openTriageMenu();
    const items = within(menu).getAllByRole("menuitem");

    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: /triage email/i })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("reserves the work cluster for Remind me and Ask Alfred ahead of organize and utility actions", () => {
    renderReader({ onRemind: () => {}, onAskAlfred: () => {} });

    const remindButton = screen.getByRole("button", { name: /remind me/i });
    expect(remindButton.closest("[data-slot='tooltip-trigger']")).toBeNull();
    expect(screen.getByRole("button", { name: /ask alfred/i }).dataset.alfred).toBe("true");
    const clusters = screen.getByTestId("desktop-reader-action-bar")
      .querySelectorAll<HTMLElement>("[data-action-cluster]");
    expect(Array.from(clusters, (cluster) => cluster.dataset.actionCluster)).toEqual([
      "work",
      "organize",
      "utilities",
    ]);
  });

  it("hands focus from Triage to Snooze and restores it when the picker closes", async () => {
    renderReader();
    const { trigger, menu } = openTriageMenu();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /snooze/i }));
    const picker = await screen.findByRole("menu", { name: "Snooze" });
    expect(screen.queryByRole("menu", { name: /triage email/i })).toBeNull();
    await waitFor(() => expect(picker.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Snooze" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the bill-pay affordance visible for triaged finance bill emails", () => {
    renderReader({
      email: {
        subject: "Utility payment due",
        category: "finance",
        hasBill: true,
        _untriaged: false,
      },
    });

    expect(screen.getByRole("button", { name: /pay bill/i })).toBeTruthy();
  });

  it("opens an already-recorded transaction in the calendar instead of the inline bill drawer", () => {
    renderReader({
      billOpen: true,
      email: {
        subject: "Utility payment due",
        category: "finance",
        hasBill: true,
      },
      billResolution: {
        status: "resolved",
        actualStatus: {
          status: "already_recorded",
          evidence: {
            kind: "transaction",
            transactionId: "transaction-42",
            dueDate: "2026-07-16",
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /view bill/i }));

    expect(screen.getByLabelText("Opened recorded bill").textContent).toBe(JSON.stringify({
      date: "2026-07-16", itemId: "transaction-42",
    }));
    expect(screen.getByLabelText("Bill drawer state").textContent).toBe("open");
  });

  it("opens a matched bill without wrapping its self-explanatory action in a tooltip", () => {
    renderReader({
      email: {
        subject: "Utility payment due",
        category: "finance",
        hasBill: true,
      },
      billResolution: {
        status: "resolved",
        actualStatus: {
          status: "already_scheduled",
          evidence: {
            kind: "schedule",
            scheduleId: "schedule-acme",
            dueDate: "2026-08-12",
          },
        },
      },
    });

    const button = screen.getByRole("button", { name: /view bill/i });
    expect(button.closest("[data-slot='tooltip-trigger']")).toBeNull();
    fireEvent.click(button);
    expect(screen.getByLabelText("Opened recorded bill").textContent).toContain("schedule-acme");
  });

  it("keeps a previously opened bill drawer mounted but inert while closed", () => {
    renderReader({
      billOpen: false,
      billMounted: true,
      email: { hasBill: true },
    });

    const drawer = document.querySelector<HTMLElement>("aside[data-state='closed']");
    expect(drawer?.getAttribute("aria-hidden")).toBe("true");
    expect(drawer?.hasAttribute("inert")).toBe(true);
    expect(drawer?.style.pointerEvents).toBe("none");
  });

  it("shows compact desktop key hints for immediate reader actions", () => {
    renderReader();

    const move = openMoveMenu();
    expect(within(move.menu).getByRole("menuitem", { name: "FYI" }).textContent).toContain("F");
    expect(within(move.menu).getByRole("menuitem", { name: "Noise" }).textContent).toContain("N");
    fireEvent.keyDown(document, { key: "Escape" });
    const triage = openTriageMenu();
    expect(within(triage.menu).getByRole("menuitem", { name: /mark handled/i }).textContent).toContain("H");
    expect(within(triage.menu).getByRole("menuitem", { name: /dismiss from today/i }).textContent).toContain("D");
    expect(within(triage.menu).getByRole("menuitem", { name: /snooze/i }).textContent).toContain("S");
    expect(within(triage.menu).getByRole("menuitem", { name: /^pin$/i }).textContent).toContain("P");
    expect(screen.getByRole("button", { name: /trash email/i }).textContent).toContain("E");
  });

  it("suspends inbox hotkeys while the desktop snooze menu is open without moving focus", () => {
    renderReader({ snoozeOpen: true });
    const triageButton = screen.getByRole("button", { name: /^triage$/i });
    triageButton.focus();

    expect(document.activeElement).toBe(triageButton);
    expect(shouldSuspendInboxHotkeys(triageButton)).toBe(true);
  });

});

describe("DesktopReader pin toggle", () => {
  it("renders the current pin state", () => {
    renderReader({ email: { _pinned: true } });
    expect(within(openTriageMenu().menu).getByRole("menuitem", { name: /^unpin$/i })).toBeTruthy();
  });
});

describe("DesktopReader draft reply (P1-2)", () => {
  it("copies the AI draft to the clipboard without trashing the email", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderReader({
      showDraft: true,
      email: { claude: { draftReply: "Thanks, that works for me." } },
    });

    // The draft panel's primary action must copy, not send-and-trash. There is
    // no send endpoint, so the old "Send" button silently trashed the email.
    fireEvent.click(screen.getByRole("button", { name: /copy draft/i }));

    await waitFor(() => expect(screen.getByLabelText("Draft state").textContent).toBe("closed"));
    // test-architecture: allow-boundary-interaction -- navigator.clipboard is the browser boundary and copied text has no DOM or durable-state projection.
    expect(writeText).toHaveBeenCalledWith("Thanks, that works for me.");
    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
  });
});
