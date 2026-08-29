import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarQuickActionLayer from "./CalendarQuickActionLayer";
import type { CalendarQuickActionEvent } from "./calendarQuickActionModel";
import type { QuickActionContextMenu } from "./useCalendarQuickActions";

interface RenderLayerOptions {
  event: Pick<CalendarQuickActionEvent, "id"> & Partial<CalendarQuickActionEvent>;
  overrides?: Partial<QuickActionContextMenu>;
}

afterEach(cleanup);

function renderLayer({ event, overrides = {} }: RenderLayerOptions) {
  const quickActions = {
    contextMenu: {
      event: {
        startMs: 0,
        endMs: 0,
        ...event,
      },
      x: 140,
      y: 180,
      busy: false,
      confirm: false,
      error: null,
      ...overrides,
    },
    closeContextMenu: vi.fn(),
    copyContextEvent: vi.fn(),
    duplicateContextEvent: vi.fn(),
    requestDelete: vi.fn(),
    confirmContextDelete: vi.fn(),
    chooseEventColor: vi.fn(),
    setPromptScope: vi.fn(),
    confirmPrompt: vi.fn(),
    cancelPrompt: vi.fn(),
    status: null,
    prompt: null,
  };
  return render(<CalendarQuickActionLayer quickActions={quickActions} />);
}

describe("CalendarQuickActionLayer keyboard contract", () => {
  it("keeps tab focus looping inside the color grid", async () => {
    renderLayer({ event: { id: "e1", colorId: "11" } });

    const red = await screen.findByTestId("calendar-event-color-11");
    await waitFor(() => {
      expect(document.activeElement).toBe(red);
    });

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("calendar-event-color-1"));

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(red);
  });
});
