import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CalendarDraftPreviewPanel from "./CalendarDraftPreviewPanel";

afterEach(() => {
  cleanup();
});

describe("CalendarDraftPreviewPanel", () => {
  it("renders the schedule and repeat summaries for a single draft", () => {
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

    expect(screen.getByText("Apr 21, 2026 · 1:00 PM to 1:30 PM")).toBeTruthy();
    expect(screen.getByText("Does not repeat")).toBeTruthy();
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
