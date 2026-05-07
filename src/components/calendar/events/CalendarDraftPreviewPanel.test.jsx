import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CalendarDraftPreviewPanel from "./CalendarDraftPreviewPanel.jsx";

afterEach(() => {
  cleanup();
});

describe("CalendarDraftPreviewPanel", () => {
  it("keeps schedule times visible while compacting other preview segments", () => {
    render(
      <CalendarDraftPreviewPanel
        ghostPreview={{
          ghosts: [{
            id: "event-ghost",
            title: "Check-in IHSS",
            startDate: "2026-04-21",
            endDate: "2026-04-21",
            startTime: "13:00",
            endTime: "13:30",
          }],
          totalConflictCount: 0,
        }}
        draft={{
          startDate: "2026-04-21",
          endDate: "2026-04-21",
          startTime: "13:00",
          endTime: "13:30",
          location: "",
        }}
        selectedSource={{ summary: "Personal", color: "#89b4fa" }}
        recurrenceDraft={null}
      />,
    );

    const schedule = screen.getByText("Apr 21, 2026 · 1:00 PM to 1:30 PM");
    const scheduleSegment = schedule.closest("span")?.parentElement;

    expect(scheduleSegment?.style.flex).toBe("0 0 auto");
    expect(scheduleSegment?.style.maxWidth).toBe("100%");
    expect(schedule.style.maxWidth).toBe("100%");
    expect(schedule.style.whiteSpace).toBe("normal");
    expect(schedule.style.overflow).toBe("visible");

    const repeat = screen.getByText("Does not repeat");
    expect(repeat.style.maxWidth).toBe("min(190px, 100%)");
    expect(repeat.style.whiteSpace).toBe("nowrap");
    expect(repeat.style.overflow).toBe("hidden");
  });

  it("labels recurring edit instances honestly when the structured rule is missing", () => {
    render(
      <CalendarDraftPreviewPanel
        ghostPreview={null}
        draft={{
          startDate: "2026-04-21",
          endDate: "2026-04-21",
          startTime: "13:00",
          endTime: "13:30",
          location: "",
        }}
        selectedSource={{ summary: "Personal", color: "#89b4fa" }}
        recurrenceDraft={null}
        isRecurringEvent
        showDraftFallback
      />,
    );

    expect(screen.getByText("Recurring event")).toBeTruthy();
    expect(screen.queryByText("Does not repeat")).toBeNull();
  });
});
