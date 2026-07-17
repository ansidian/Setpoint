// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { ComponentProps, SetStateAction } from "react";
import DesktopReader from "./DesktopReader";
import { shouldSuspendInboxHotkeys } from "../inboxHotkeys";
import type { InboxEmailLike } from "../inboxTypes";
import { IDLE_BILL_RESOLUTION } from "./readerTypes";
import type { BillResolutionState } from "./readerTypes";

const billBadgeMock = vi.hoisted(() => vi.fn());

vi.mock("../../bills/BillBadge", () => ({
  default: function BillBadgeMock(props: Record<string, unknown>) {
    billBadgeMock(props);
    return <div data-testid="bill-badge" />;
  },
}));

afterEach(() => {
  cleanup();
  billBadgeMock.mockClear();
});

type DesktopReaderOverrides = Omit<Partial<ComponentProps<typeof DesktopReader>>, "email" | "billResolution"> & {
  email?: Partial<InboxEmailLike>;
  billResolution?: Partial<BillResolutionState>;
};

function renderReader(overrides: DesktopReaderOverrides = {}) {
  const onAction = vi.fn();
  const onOpenRecordedBill = overrides.onOpenRecordedBill || vi.fn();
  const setBillOpen = overrides.setBillOpen || vi.fn();
  const setDrafting = overrides.setDrafting || vi.fn();
  function ReaderHarness() {
    const [snoozeOpen, setSnoozeOpen] = useState(overrides.snoozeOpen ?? false);
    const updateSnooze = (value: SetStateAction<boolean>) => {
      setSnoozeOpen(value);
      overrides.setSnoozeOpen?.(value);
    };
    return <DesktopReader
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
      billOpen={overrides.billOpen || false}
      billMounted={overrides.billMounted || false}
      setBillOpen={setBillOpen}
      onOpenRecordedBill={onOpenRecordedBill}
      snoozeOpen={snoozeOpen}
      setSnoozeOpen={updateSnooze}
      bodyState={overrides.bodyState || { loading: false, error: null, body: "", source: "loaded" }}
      billResolution={overrides.billResolution ? { ...IDLE_BILL_RESOLUTION, ...overrides.billResolution } : undefined}
      drafting={overrides.drafting || false}
      setDrafting={setDrafting}
      readOnly={overrides.readOnly || false}
      onRemind={overrides.onRemind}
      onAskAlfred={overrides.onAskAlfred}
    />;
  }
  render(<ReaderHarness />);
  return { onAction, onOpenRecordedBill, setBillOpen, setDrafting };
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
  it("groups ordered lane and triage commands under stable labelled triggers", () => {
    renderReader();

    const move = openMoveMenu();
    const moveItems = within(move.menu).getAllByRole("menuitem");
    expect(moveItems.map((item) => item.textContent)).toEqual(["FYIF", "NoiseN"]);
    expect(moveItems[0]?.querySelector(".desktop-reader-action-menu-key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Trash email" }).querySelector(".desktop-reader-action-menu-key")).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    const triage = openTriageMenu();
    const triageItems = within(triage.menu).getAllByRole("menuitem");
    expect(triageItems.map((item) => item.textContent)).toEqual([
      "Mark handledH",
      "Dismiss from todayD",
      "Snooze…S",
      "PinP",
      "Mark read",
    ]);
  });

  it("closes grouped menus after dispatch and restores focus to the trigger", () => {
    const { onAction } = renderReader();
    const { trigger, menu } = openMoveMenu();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /^fyi$/i }));

    expect(onAction).toHaveBeenCalledWith("snapshot-move-lane", "fyi");
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
    const onRemind = vi.fn();
    const onAskAlfred = vi.fn();
    renderReader({ onRemind, onAskAlfred });

    const remindButton = screen.getByRole("button", { name: /remind me/i });
    expect(remindButton.closest("[data-slot='tooltip-trigger']")).toBeNull();
    fireEvent.click(remindButton);
    fireEvent.click(screen.getByRole("button", { name: /ask alfred/i }));

    expect(onRemind).toHaveBeenCalledOnce();
    expect(onAskAlfred).toHaveBeenCalledOnce();
    const clusters = screen.getByTestId("desktop-reader-action-bar")
      .querySelectorAll<HTMLElement>("[data-action-cluster]");
    expect(Array.from(clusters, (cluster) => cluster.dataset.actionCluster)).toEqual([
      "work",
      "organize",
      "utilities",
    ]);
  });

  it("disables Move as a whole while leaving unaffected Triage commands available", () => {
    renderReader({ email: { _optimisticSnapshotPending: true } });

    expect((screen.getByRole("button", { name: /move to/i }) as HTMLButtonElement).disabled).toBe(true);
    const triage = openTriageMenu();
    expect((within(triage.menu).getByRole("menuitem", { name: /mark handled/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(triage.menu).getByRole("menuitem", { name: /dismiss from today/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(triage.menu).getByRole("menuitem", { name: /snooze/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(triage.menu).getByRole("menuitem", { name: /^pin$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(triage.menu).getByRole("menuitem", { name: /mark read/i }) as HTMLButtonElement).disabled).toBe(false);
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

  it("shows an actioned Actual match and turns bill pay into a review affordance", () => {
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
          evidence: { amount: 142.31, dueDate: "2026-08-12" },
        },
      },
    });

    expect(screen.getByText("Already scheduled in Actual")).toBeTruthy();
    expect(screen.getByRole("button", { name: /view bill/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /pay bill/i })).toBeNull();
  });

  it("opens an already-recorded transaction in the calendar instead of the inline bill drawer", () => {
    const { onOpenRecordedBill, setBillOpen } = renderReader({
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

    expect(onOpenRecordedBill).toHaveBeenCalledWith({
      date: "2026-07-16",
      itemId: "transaction-42",
    });
    expect(setBillOpen).not.toHaveBeenCalled();
  });

  it("opens an already-scheduled bill in the calendar instead of the inline bill drawer", () => {
    const { onOpenRecordedBill, setBillOpen } = renderReader({
      billOpen: true,
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

    fireEvent.click(screen.getByRole("button", { name: /view bill/i }));

    expect(onOpenRecordedBill).toHaveBeenCalledWith({
      date: "2026-08-12",
      itemId: "schedule-acme",
    });
    expect(setBillOpen).not.toHaveBeenCalled();
  });

  it("opens a matched bill without wrapping its self-explanatory action in a tooltip", () => {
    const { onOpenRecordedBill } = renderReader({
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
    expect(onOpenRecordedBill).toHaveBeenCalled();
  });

  it("hides the bill-pay affordance for triaged non-bill emails", () => {
    renderReader({
      email: {
        subject: "Regular update",
        category: "needs_attention",
        hasBill: false,
        _untriaged: false,
      },
    });

    expect(screen.queryByRole("button", { name: /pay bill/i })).toBeNull();
  });

  it("passes the loaded provider body to bill extraction instead of the row preview", () => {
    renderReader({
      billOpen: true,
      billMounted: true,
      email: {
        subject: "Card payment due",
        preview: "Short preview without the full statement.",
        body: "Old row body summary.",
        hasBill: true,
      },
      bodyState: {
        loading: false,
        error: null,
        body: "<html><body>Full provider statement with amount $132.14 due May 10.</body></html>",
        source: "loaded",
      },
    });

    expect(screen.getByTestId("bill-badge")).toBeTruthy();
    expect(billBadgeMock).toHaveBeenCalledWith(expect.objectContaining({
      emailBody: "<html><body>Full provider statement with amount $132.14 due May 10.</body></html>",
      emailBodyLoading: false,
      emailBodySource: "loaded",
    }));
  });

  it("shows manual correction controls for active snapshot rows", () => {
    renderReader();

    const move = openMoveMenu();
    expect(within(move.menu).getByRole("menuitem", { name: "FYI" })).toBeTruthy();
    expect(within(move.menu).getByRole("menuitem", { name: "Noise" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    const triage = openTriageMenu();
    expect(within(triage.menu).getByRole("menuitem", { name: /mark handled/i })).toBeTruthy();
    expect(within(triage.menu).getByRole("menuitem", { name: /dismiss from today/i })).toBeTruthy();
    expect(within(triage.menu).getByRole("menuitem", { name: /^pin$/i })).toBeTruthy();
  });

  it("allows FYI snapshot rows to be marked handled", () => {
    const { onAction } = renderReader({ email: { _lane: "fyi" } });

    const move = openMoveMenu();
    expect(within(move.menu).queryByRole("menuitem", { name: "FYI" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    const handledButton = within(openTriageMenu().menu).getByRole("menuitem", { name: /mark handled/i });
    expect(handledButton.textContent).toContain("H");

    fireEvent.click(handledButton);
    expect(onAction).toHaveBeenCalledWith("snapshot-handled");
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

	  it("dispatches snapshot lane and lifecycle actions", () => {
    const { onAction } = renderReader();

    fireEvent.click(within(openMoveMenu().menu).getByRole("menuitem", { name: "FYI" }));
    fireEvent.click(within(openTriageMenu().menu).getByRole("menuitem", { name: /mark handled/i }));
    fireEvent.click(within(openTriageMenu().menu).getByRole("menuitem", { name: /dismiss from today/i }));

    expect(onAction).toHaveBeenCalledWith("snapshot-move-lane", "fyi");
    expect(onAction).toHaveBeenCalledWith("snapshot-handled");
	    expect(onAction).toHaveBeenCalledWith("snapshot-dismiss");
	  });

	  it("shows Reopen for handled active snapshot rows", () => {
	    const { onAction } = renderReader({
	      email: {
	        _lane: "handled",
	        handled_at: "2026-05-03T16:10:00.000Z",
	      },
	    });

	    expect(screen.queryByRole("button", { name: /move to/i })).toBeNull();
	    const reopen = within(openTriageMenu().menu).getByRole("menuitem", { name: /reopen/i });
	    expect(reopen.textContent).toContain("H");
	    expect(screen.queryByRole("menuitem", { name: /mark handled/i })).toBeNull();

	    fireEvent.click(reopen);
	    expect(onAction).toHaveBeenCalledWith("snapshot-reopen");
	  });

  it("hides mutating actions for read-only snapshot rows", () => {
    renderReader({ readOnly: true });

    expect(screen.queryByRole("button", { name: /move to/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /trash email/i })).toBeNull();
    // Pin is exempt from the readOnly gate — pinning from a frozen snapshot is the feature.
    const triage = openTriageMenu();
    expect(within(triage.menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["PinP"]);
  });

  it("limits Catch-up rows to read state and Gmail open actions", () => {
    renderReader({
      email: {
        id: "gmail-gmail-work-late-fyi",
        uid: "gmail-gmail-work-late-fyi",
        account_id: "gmail-work",
        account_email: "work@example.test",
        _lane: "catch_up",
        lane_at_snapshot: "fyi",
        hasBill: true,
        claude: { draftReply: "Thanks." },
      },
    });

    expect(screen.getByRole("button", { name: /open in gmail/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /move to/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /trash email/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pay bill/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /review reply/i })).toBeNull();
    const triage = openTriageMenu();
    expect(within(triage.menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "PinP",
      "Mark read",
    ]);
  });

  it("keeps queued snapshot rows dismissible but blocks manual triage and handled workflows", () => {
    const { onAction } = renderReader({
      email: {
        _lane: "queued",
        _arrivalGraceQueued: true,
        hasBill: false,
      },
    });

    expect(screen.getByRole("button", { name: /pay bill/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /trash email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /move to/i })).toBeNull();
    const triage = openTriageMenu();
    expect(within(triage.menu).queryByRole("menuitem", { name: /mark handled/i })).toBeNull();
    expect(within(triage.menu).getByRole("menuitem", { name: /dismiss from today/i })).toBeTruthy();
    expect(within(triage.menu).getByRole("menuitem", { name: /mark read/i })).toBeTruthy();
    expect(within(triage.menu).getByRole("menuitem", { name: /snooze/i })).toBeTruthy();

    fireEvent.click(within(triage.menu).getByRole("menuitem", { name: /dismiss from today/i }));
    expect(onAction).toHaveBeenCalledWith("snapshot-dismiss");
  });

  it("keeps untriaged-read snapshot rows out of snapshot lifecycle actions", () => {
    renderReader({
      email: {
        _lane: "untriaged_read",
        _untriagedRead: true,
        read: true,
        hasBill: false,
      },
    });

    expect(screen.getByRole("button", { name: /pay bill/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /trash email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /move to/i })).toBeNull();
    const triage = openTriageMenu();
    expect(within(triage.menu).getByRole("menuitem", { name: /mark unread/i })).toBeTruthy();
    expect(within(triage.menu).getByRole("menuitem", { name: /snooze/i })).toBeTruthy();
    expect(within(triage.menu).queryByRole("menuitem", { name: /dismiss from today/i })).toBeNull();
    expect(within(triage.menu).queryByRole("menuitem", { name: /mark handled/i })).toBeNull();
  });

  it("hides snapshot lifecycle actions when snapshot_item_id is missing (drift guard)", () => {
    // An active-snapshot row without a snapshot_item_id cannot be acted on (the
    // dispatch + hotkeys both require it), so the buttons must not appear.
    renderReader({ email: { _lane: "needs_attention", snapshot_item_id: undefined } });

    expect(screen.queryByRole("button", { name: /move to/i })).toBeNull();
    const triage = openTriageMenu();
    expect(within(triage.menu).queryByRole("menuitem", { name: /mark handled/i })).toBeNull();
    expect(within(triage.menu).queryByRole("menuitem", { name: /dismiss from today/i })).toBeNull();
  });
});

describe("DesktopReader pin toggle", () => {
  it("dispatches pin-toggle when clicked", () => {
    const { onAction } = renderReader();

    fireEvent.click(within(openTriageMenu().menu).getByRole("menuitem", { name: /^pin$/i }));
    expect(onAction).toHaveBeenCalledWith("pin-toggle");
  });

  it("flips the aria-label when the email is pinned", () => {
    renderReader({ email: { _pinned: true } });

    const triage = openTriageMenu();
    expect(within(triage.menu).getByRole("menuitem", { name: /^unpin$/i })).toBeTruthy();
    expect(within(triage.menu).queryByRole("menuitem", { name: /^pin$/i })).toBeNull();
  });

  it("renders even for catch-up rows", () => {
    renderReader({
      email: {
        _lane: "catch_up",
        lane_at_snapshot: "fyi",
      },
    });

    expect(within(openTriageMenu().menu).getByRole("menuitem", { name: /^pin$/i })).toBeTruthy();
  });
});

describe("DesktopReader draft reply (P1-2)", () => {
  it("copies the AI draft to the clipboard without trashing the email", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { onAction, setDrafting } = renderReader({
      showDraft: true,
      email: { claude: { draftReply: "Thanks, that works for me." } },
    });

    // The draft panel's primary action must copy, not send-and-trash. There is
    // no send endpoint, so the old "Send" button silently trashed the email.
    fireEvent.click(screen.getByRole("button", { name: /copy draft/i }));

    await waitFor(() => expect(setDrafting).toHaveBeenCalledWith(false));
    expect(writeText).toHaveBeenCalledWith("Thanks, that works for me.");
    expect(onAction).not.toHaveBeenCalledWith("trash");
    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
  });
});
