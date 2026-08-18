import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useEventReminderDrafts from "./useEventReminderDrafts";

const api = vi.hoisted(() => ({ deleteReminder: vi.fn() }));

// test-architecture: allow-boundary-mock -- The reminder API is the hook's outbound persistence boundary; a rejected delete is required to exercise optimistic rollback.
vi.mock("@/api", () => api);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useEventReminderDrafts", () => {
  it("restores a persisted Time-to-Leave reminder when deletion fails", async () => {
    api.deleteReminder.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useEventReminderDrafts({
      draft: {
        allDay: false,
        startDate: "2099-05-06",
        startTime: "09:00",
      },
    }));
    const reminder = {
      id: "ttl-1",
      reminder_kind: "time_to_leave" as const,
      arrival_buffer_minutes: 15,
      status: "pending",
    };

    act(() => result.current.setEventReminders([reminder]));
    await act(async () => {
      await result.current.removeTimeToLeave();
    });

    expect(result.current.timeToLeaveReminder).toEqual(reminder);
    expect(result.current.reminderError).toMatch(/restored/);
    // test-architecture: allow-boundary-interaction -- The rollback requires exercising the reminders API failure boundary; the hook result proves restoration but not which persisted row was targeted.
    expect(api.deleteReminder).toHaveBeenCalledWith("ttl-1");
  });
});
