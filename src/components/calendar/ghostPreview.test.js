import { describe, expect, it } from "vitest";
import {
  buildDeadlineGhostPreview,
  buildEventGhostPreview,
} from "./ghostPreview.js";

describe("calendar ghost previews", () => {
  it("previews finite batch event drafts and only the first recurring occurrence", () => {
    const baseEditor = {
      isEditorOpen: true,
      draft: {
        accountId: "gmail-main",
        calendarId: "primary",
        allDay: false,
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        startTime: "09:00",
        endTime: "09:30",
      },
      effectiveTitle: "Work",
      writableCalendars: [{ value: "gmail-main::primary", color: "#4285f4" }],
    };

    const batch = buildEventGhostPreview({
      editor: {
        ...baseEditor,
        intentState: { mode: "batch" },
        batchDrafts: [
          { title: "Work", startDate: "2026-04-20", endDate: "2026-04-20", startTime: "09:00", endTime: "09:30" },
          { title: "Work", startDate: "2026-04-21", endDate: "2026-04-21", startTime: "09:00", endTime: "09:30" },
        ],
      },
      events: [],
    });
    expect(batch.ghosts).toHaveLength(2);
    expect(batch.targetDate).toBe("2026-04-20");

    const recurring = buildEventGhostPreview({
      editor: {
        ...baseEditor,
        intentState: { mode: "recurring" },
        recurrenceDraft: { frequency: "weekly" },
      },
      events: [],
    });
    expect(recurring.ghosts).toHaveLength(1);
    expect(recurring.ghosts[0].recurring).toBe(true);
  });

  it("keeps deadline ghosts single-day and suppresses unchanged edits", () => {
    const unchanged = buildDeadlineGhostPreview({
      draft: {
        title: "Ship report",
        dueDate: "2026-04-20",
        dueTime: "9:00 AM",
        isEditing: true,
        placementChanged: false,
      },
      dateItems: { activeCount: 2 },
    });
    expect(unchanged).toBeNull();

    const changed = buildDeadlineGhostPreview({
      draft: {
        title: "Ship report",
        dueDate: "2026-04-21",
        dueTime: "9:00 AM",
        source: "todoist",
        priority: 1,
        isEditing: true,
        placementChanged: true,
      },
      dateItems: { activeCount: 3 },
    });
    expect(changed.ghosts).toHaveLength(1);
    expect(changed.ghosts[0]).toMatchObject({
      kind: "deadline",
      startDate: "2026-04-21",
      endDate: "2026-04-21",
      color: "#e8776a",
      dueMinutes: 540,
      source: "todoist",
      crowdedCount: 3,
    });
  });
});
