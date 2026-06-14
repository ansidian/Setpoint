import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./CalendarEventEditor.test-setup.js";
import { renderModal, openFloatingEventEditorFromSelectedChip } from "./CalendarEventEditor.test-utils.jsx";

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
    });
  });

  it("uses the compact summary as the only persistent parsed schedule verification", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Dinner on Apr 21 at 5pm" },
    });

    await waitFor(() => {
      const summary = screen.getByTestId("calendar-draft-preview-summary");
      expect(summary.textContent).toMatch(/apr 21, 2026/i);
      expect(summary.textContent).toMatch(/5:00 pm to 5:30 pm/i);
      expect(screen.queryByTestId("calendar-event-title-preview")).toBeNull();
      expect(screen.queryByTestId("calendar-event-title-mode-preview")).toBeNull();
    });
  });

  it("keeps source and location assist visible without repeating parsed schedule copy", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Dinner @McDonald's tomorrow 5pm cal personal" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-title-location-preview").textContent).toMatch(/mcdonald's/i);
      expect(screen.getByTestId("calendar-event-title-source-preview").textContent).toMatch(/personal/i);
      expect(screen.queryByTestId("calendar-event-title-preview")).toBeNull();
      expect(screen.queryByTestId("calendar-event-title-mode-preview")).toBeNull();
    });
  });

  it("adds restrained semantic signaling to compact summary segments", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.input(screen.getByTestId("calendar-event-title"), {
      target: { value: "Work at 3am to 8am every monday" },
    });

    await waitFor(() => {
      const segments = screen.getAllByTestId("calendar-draft-preview-segment");
      expect(segments.map((segment) => segment.getAttribute("data-summary-kind"))).toEqual(
        expect.arrayContaining(["schedule", "source", "location", "repeat"]),
      );
      expect(segments.find((segment) => segment.getAttribute("data-summary-kind") === "schedule")?.style.color).toBeTruthy();
      expect(segments.find((segment) => segment.getAttribute("data-summary-kind") === "repeat")?.textContent).toMatch(/every mon/i);
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
      // The ghost preview's dotted border is authored as `1px dotted color-mix(...)`.
      // happy-dom's CSS parser cannot serialize `color-mix()`, so it drops the whole
      // border declaration (style.border is ""). The dotted border, cursor:default, and
      // pointerEvents:none all derive from the identical `ghost === true` branch in
      // chipStyle(), so these two survivors prove the chip rendered with its
      // non-interactive preview treatment rather than a solid committed-chip style.
      expect(chip.style.pointerEvents).toBe("none");
      expect(chip.style.cursor).toBe("default");
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/overlaps 1 event/i);
    });
  });

  it("shows seeded edit metadata when unchanged placement suppresses the ghost preview", async () => {
    renderModal({
      events: [{
        id: "event-edit-metadata",
        title: "Planning block",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-20T17:00:00.000Z").getTime(),
        writable: true,
        isRecurring: false,
        allDay: false,
      }],
    });

    await openFloatingEventEditorFromSelectedChip();

    expect(screen.queryByTestId("calendar-ghost-overlay")).toBeNull();
    const summary = screen.getByTestId("calendar-draft-preview-summary");
    expect(summary.textContent).toMatch(/apr 20, 2026/i);
    expect(summary.textContent).toMatch(/9:00 am to 10:00 am/i);
    expect(summary.textContent).toMatch(/personal/i);
    expect(summary.textContent).toMatch(/no location/i);
    expect(summary.textContent).toMatch(/does not repeat/i);
  });

  it("renders a multi-day ghost as a spanning draft chip from the compact schedule picker", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("calendar-event-start-date"));
    const picker = await screen.findByRole("dialog", { name: /compact schedule picker/i });
    fireEvent.click(within(picker).getByRole("button", { name: /end date/i }));
    await waitFor(() => {
      expect(within(picker).getByRole("button", { name: "19" }).disabled).toBe(true);
    });
    fireEvent.click(within(picker).getByRole("button", { name: "22" }));
    fireEvent.click(within(picker).getByRole("button", { name: /done/i }));

    await waitFor(() => {
      const chip = screen.getByTestId("calendar-ghost-chip");
      expect(chip.getAttribute("data-ghost-start")).toBe("2026-04-20");
      expect(chip.getAttribute("data-ghost-end")).toBe("2026-04-22");
      expect(chip.style.gridColumn).toBe("2 / 5");
    });
  });

  it("debounces ghost-driven month navigation for NLP date changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-20T19:00:00.000Z"));

    try {
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: /new event/i }));
      expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();

      fireEvent.input(screen.getByTestId("calendar-event-title"), {
        target: { value: "Planning block May 12 at 9am" },
      });

      await waitFor(() => {
        expect(screen.getByTestId("calendar-month-title").textContent).toMatch(/May 2026/i);
        expect(screen.getByTestId("calendar-ghost-chip").getAttribute("data-ghost-start")).toBe("2026-05-12");
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
