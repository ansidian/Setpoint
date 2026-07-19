import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./CalendarEventEditor.test-setup.ts";
import { renderModal, openFloatingEventEditorFromSelectedChip } from "./CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor ghost preview behavior", () => {
  it("renders a non-interactive ghost preview for a valid create draft", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("calendar-ghost-chip").textContent).toMatch(/untitled/i);
      expect(screen.getByTestId("calendar-ghost-chip").textContent).not.toMatch(/draft|conflict|repeat/i);
      expect(screen.queryByTestId("calendar-ghost-overlay")).toBeNull();
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/apr 20, 2026/i);
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).not.toMatch(/draft preview/i);
      expect(screen.queryByTestId("calendar-event-title-preview")).toBeNull();
      expect(screen.queryByTestId("calendar-event-title-mode-preview")).toBeNull();
    });
  });

  it("suppresses edit ghosts until placement changes, then flags conflicts excluding the original event", async () => {
    const original = {
      id: "event-edit-ghost",
      etag: '"etag-edit-ghost"',
      title: "Planning block",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
      endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    const conflict = {
      id: "event-conflict",
      title: "Existing hold",
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: new Date("2026-04-21T16:15:00.000Z").getTime(),
      endMs: new Date("2026-04-21T17:15:00.000Z").getTime(),
      writable: true,
      isRecurring: false,
      allDay: false,
    };
    renderModal({ events: [original, conflict] });

    await openFloatingEventEditorFromSelectedChip();
    expect(screen.queryByTestId("calendar-ghost-overlay")).toBeNull();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Planning block Apr 21 at 9am" },
    });

    await waitFor(() => {
      const chip = screen.getByTestId("calendar-ghost-chip");
      expect(chip.textContent).not.toMatch(/conflict|draft|repeat/i);
      expect(chip.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/overlaps 1 event/i);
    });
  });

  it("renders a multi-day ghost as a spanning draft chip from the compact schedule picker", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-start-date"));
    const picker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    fireEvent.click(within(picker).getByRole("button", { name: /end date/i }));
    await waitFor(() => {
      expect((within(picker).getByRole("button", { name: "19" }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(within(picker).getByRole("button", { name: "22" }));
    fireEvent.click(within(picker).getByRole("button", { name: /done/i }));

    await waitFor(() => {
      const chip = screen.getByTestId("calendar-ghost-chip");
      expect(chip.getAttribute("data-ghost-start")).toBe("2026-04-20");
      expect(chip.getAttribute("data-ghost-end")).toBe("2026-04-22");
    });
  });

});
