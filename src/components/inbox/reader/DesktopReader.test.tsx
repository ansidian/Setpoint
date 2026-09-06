import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ComponentProps, type SetStateAction } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesktopReader from "./DesktopReader";
import type { InboxEmailLike } from "../inboxTypes";

afterEach(cleanup);

type ReaderOverrides = Omit<Partial<ComponentProps<typeof DesktopReader>>, "email"> & {
  email?: Partial<InboxEmailLike>;
};

function renderReader(overrides: ReaderOverrides = {}) {
  function Harness() {
    const [snoozeOpen, setSnoozeOpen] = useState(false);
    const [drafting, setDrafting] = useState(overrides.drafting ?? false);
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
      onAction={() => {}}
      onClose={() => {}}
      showTriage={false}
      showDraft={overrides.showDraft ?? false}
      billOpen={false}
      billMounted={false}
      setBillOpen={() => {}}
      snoozeOpen={snoozeOpen}
      setSnoozeOpen={updateSnooze}
      bodyState={{ loading: false, error: null, body: "", source: "loaded" }}
      drafting={drafting}
      setDrafting={setDrafting}
      readOnly={false}
    />;
  }

  render(<Harness />);
}

function openMoreMenu() {
  const trigger = screen.getByRole("button", { name: /more email actions/i });
  fireEvent.click(trigger);
  return {
    trigger,
    menu: screen.getByRole("menu", { name: /more email actions/i }),
  };
}

describe("DesktopReader durable interactions", () => {
  it("supports menu arrow navigation, Escape dismissal, and focus restoration", async () => {
    renderReader();
    const { trigger, menu } = openMoreMenu();
    const items = within(menu).getAllByRole("menuitem");

    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: /more email actions/i })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("hands focus from the Snooze action to its picker and restores it on close", async () => {
    renderReader();
    const trigger = screen.getByRole("button", { name: /^snooze$/i });
    fireEvent.click(trigger);
    const picker = await screen.findByRole("menu", { name: "Snooze" });
    await waitFor(() => expect(picker.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Snooze" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("copies an AI draft through the browser clipboard boundary", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderReader({
      showDraft: true,
      drafting: true,
      email: { claude: { draftReply: "Thanks, that works for me." } },
    });

    fireEvent.click(screen.getByRole("button", { name: /copy draft/i }));

    // test-architecture: allow-boundary-interaction -- clipboard contents have no durable DOM projection after the draft closes.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Thanks, that works for me."));
  });
});
