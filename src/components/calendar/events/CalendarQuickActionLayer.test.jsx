import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarQuickActionLayer from "./CalendarQuickActionLayer.jsx";

// Auto-cleanup is not enabled globally (no globals/setupFiles in vitest.config),
// and this layer renders its menu through createPortal into document.body — so we
// must unmount between cases to keep portals from leaking across tests.
afterEach(cleanup);

// Renders the quick-action layer directly with a minimal contextMenu state — no
// modal, events grid, or cache wiring. This isolates the color-dot accessibility
// contract (labels, pressed/check state, roving-tabindex loop) and the
// source-color → colorId derivation owned by CalendarQuickActionLayer itself.
function renderLayer({ event, overrides = {} } = {}) {
  const chooseEventColor = vi.fn();
  const quickActions = {
    contextMenu: {
      event,
      x: 140,
      y: 180,
      busy: false,
      confirm: false,
      ...overrides,
    },
    closeContextMenu: vi.fn(),
    copyContextEvent: vi.fn(),
    duplicateContextEvent: vi.fn(),
    requestDelete: vi.fn(),
    confirmContextDelete: vi.fn(),
    chooseEventColor,
    status: null,
    prompt: null,
  };
  const utils = render(<CalendarQuickActionLayer quickActions={quickActions} />);
  return { ...utils, quickActions, chooseEventColor };
}

describe("CalendarQuickActionLayer color dots", () => {
  it("labels the selected color dot, marks it pressed/checked, and focuses it on open", async () => {
    // colorId "11" is Tomato (#dc2127) in GOOGLE_EVENT_COLORS.
    renderLayer({ event: { id: "e1", colorId: "11" } });

    const red = await screen.findByTestId("calendar-event-color-11");
    await waitFor(() => {
      expect(document.activeElement).toBe(red);
    });
    expect(document.activeElement).not.toBe(screen.getByTestId("calendar-event-context-copy"));
    expect(red.getAttribute("aria-label")).toBe("Tomato");
    expect(red.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("calendar-event-color-check-11")).toBeTruthy();
  });

  it("keeps tab focus looping inside the color grid", async () => {
    renderLayer({ event: { id: "e1", colorId: "11" } });

    const red = await screen.findByTestId("calendar-event-color-11");
    await waitFor(() => {
      expect(document.activeElement).toBe(red);
    });

    // Forward Tab from the selected dot advances to the first dot in the grid.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("calendar-event-color-1"));

    // Shift+Tab from the first dot wraps back to the last (selected) dot.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(red);
  });

  it("derives the pressed/checked dot from a source-color hex when colorId is absent", async () => {
    // #4285f4 maps to colorId "9" (Blueberry) via googleEventColorIdForSourceHex.
    renderLayer({ event: { id: "e1", colorId: null, sourceColor: "#4285f4", color: "#4285f4" } });

    expect(await screen.findByTestId("calendar-event-color-grid")).toBeTruthy();
    expect(screen.getByTestId("calendar-event-color-9").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("calendar-event-color-check-9")).toBeTruthy();
  });
});
