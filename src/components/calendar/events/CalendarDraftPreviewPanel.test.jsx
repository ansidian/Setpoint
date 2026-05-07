import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CalendarDraftPreviewPanel from "./CalendarDraftPreviewPanel.jsx";

afterEach(() => {
  cleanup();
});

describe("CalendarDraftPreviewPanel", () => {
  it("keeps event draft preview segments from shrinking into ghost labels", () => {
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
    expect(schedule.style.maxWidth).toBe("min(190px, 100%)");
  });
});
