import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureChrono } from "./events/parseCalendarTitle";
import { mockCreateCalendarEvent, mockCreateCalendarEventsBatch } from "./CalendarEventEditor.test-setup.ts";
import {
  commitTitleWithoutWallClock,
  getActiveEventSaveButton,
  getActiveRepeatTrigger,
  renderEventEditor,
  setCompactSchedulePickerTime,
} from "./events/CalendarEventEditor.test-utils.tsx";

describe("CalendarEventEditor batch and recurrence behavior", () => {
  beforeAll(async () => {
    await ensureChrono();
  });
  it("uses repeat as a recurrence popover with real recurrence state", async () => {
    const { refreshRange, upsertEvents } = renderEventEditor();
    mockCreateCalendarEvent.mockResolvedValue({
      event: {
        id: "manual-series-1",
        title: "Planning block",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-20T16:00:00.000Z").getTime(),
        endMs: new Date("2026-04-20T16:30:00.000Z").getTime(),
        writable: true,
        allDay: false,
        isRecurring: true,
      },
    });

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    commitTitleWithoutWallClock("Planning block");

    fireEvent.click(getActiveRepeatTrigger());
    const repeatPicker = await screen.findByRole("dialog", { name: /recurrence picker/i });
    fireEvent.click(within(repeatPicker).getByRole("option", { name: /weekly/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/every mon/i);
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create recurring event/i);
      expect((screen.getByTestId("calendar-event-save") as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(getActiveEventSaveButton());
    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
      expect(refreshRange).toHaveBeenCalledWith("2026-04-20", "2026-04-20");
      expect(upsertEvents).not.toHaveBeenCalled();
    });
  });

  it("renders batch review UI for batch NLP and saves via the batch API", async () => {
    const { upsertEvents } = renderEventEditor();
    mockCreateCalendarEventsBatch.mockResolvedValue({
      created: [
        {
          index: 0,
          event: {
            id: "batch-1",
            title: "Work",
            accountId: "gmail-main",
            calendarId: "primary",
            startMs: new Date("2026-04-21T11:15:00.000Z").getTime(),
            endMs: new Date("2026-04-21T14:30:00.000Z").getTime(),
            writable: true,
            allDay: false,
          },
        },
        {
          index: 1,
          event: {
            id: "batch-2",
            title: "Work",
            accountId: "gmail-main",
            calendarId: "primary",
            startMs: new Date("2026-04-24T11:15:00.000Z").getTime(),
            endMs: new Date("2026-04-24T14:30:00.000Z").getTime(),
            writable: true,
            allDay: false,
          },
        },
      ],
      failed: [],
    });

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    commitTitleWithoutWallClock("Work next tue, wed, thur at 4:15am to 7:30am");

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/3 draft events/i);
      expect(screen.getByTestId("calendar-batch-review")).toBeTruthy();
      expect(screen.queryByTestId("calendar-event-title-mode-preview")).toBeNull();
      expect((screen.getByTestId("calendar-event-save") as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId("calendar-batch-remove-1"));

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-batch-row-2")).toBeNull();
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create 2 events/i);
    });

    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(mockCreateCalendarEventsBatch).toHaveBeenCalledTimes(1);
      expect(upsertEvents).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "batch-1",
        }),
        expect.objectContaining({
          id: "batch-2",
        }),
      ]);
    });
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("edits retained batch row schedules from the compact schedule picker", async () => {
    const { upsertEvents } = renderEventEditor();
    mockCreateCalendarEventsBatch.mockResolvedValue({
      created: [
        {
          index: 0,
          event: {
            id: "batch-1",
            title: "Work",
            accountId: "gmail-main",
            calendarId: "primary",
            startMs: new Date("2026-04-29T00:00:00.000Z").getTime(),
            endMs: new Date("2026-04-29T00:30:00.000Z").getTime(),
            writable: true,
            allDay: false,
          },
        },
      ],
      failed: [],
    });

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    commitTitleWithoutWallClock("Work next tue, wed, thur at 4:15am to 7:30am");

    await waitFor(() => {
      expect(screen.getByTestId("calendar-batch-review").getAttribute("data-density")).toBe("compact");
      expect(screen.getByTestId("calendar-batch-row-0").getAttribute("data-density")).toBe("compact");
      expect(screen.getByTestId("calendar-batch-schedule-trigger-0")).toBeTruthy();
      expect(screen.queryByTestId("calendar-batch-start-date-0")).toBeNull();
      expect(screen.queryByTestId("calendar-batch-start-time-0")).toBeNull();
    });

    fireEvent.click(screen.getByTestId("calendar-batch-schedule-trigger-0"));
    const picker = await screen.findByRole("dialog", { name: /batch event 1 schedule/i });

    expect(within(picker).getByTestId("calendar-compact-schedule-summary").textContent).toMatch(/Apr 28, 2026/i);
    expect(within(picker).queryByLabelText("Start time")).toBeNull();

    fireEvent.click(within(picker).getByRole("button", { name: /end date/i }));
    fireEvent.click(within(picker).getAllByRole("button", { name: "29" }).find((button) => !(button as HTMLButtonElement).disabled)!);
    setCompactSchedulePickerTime(picker, "start time", { hour: 5, minute: 0, period: "pm" });
    fireEvent.click(within(picker).getByRole("button", { name: /done/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-batch-row-0").textContent).toMatch(/Apr 28, 2026 to Apr 29, 2026/i);
      expect(screen.getByTestId("calendar-batch-row-0").textContent).toMatch(/5:00 PM to 5:30 PM/i);
    });

    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(mockCreateCalendarEventsBatch).toHaveBeenCalledTimes(1);
      expect(upsertEvents).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "batch-1",
        }),
      ]);
    });
  });

  it("lets the batch icon collapse accidental batch parsing into a single draft", async () => {
    renderEventEditor();
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    commitTitleWithoutWallClock("Dinner 2pm tue thu");

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/2 draft events/i);
      expect(screen.getByTestId("calendar-batch-review")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("calendar-event-batch-trigger"));

    await waitFor(() => {
      expect((screen.getByTestId("calendar-event-title") as HTMLInputElement).value).toBe("Dinner");
      expect(screen.queryByTestId("calendar-batch-review")).toBeNull();
      expect(screen.queryByTestId("calendar-event-batch-trigger")).toBeNull();
      expect(screen.getByTestId("calendar-event-schedule-trigger")).toBeTruthy();
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/apr 21, 2026/i);
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/2:00 pm to 2:30 pm/i);
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create event/i);
    });
  });

  it("keeps the create composer mounted while batch NLP parsing resolves", async () => {
    renderEventEditor();
    const composerBody = await screen.findByTestId("calendar-event-editor-mode-create");
    commitTitleWithoutWallClock("Work next tue, wed, thur at 4:15am to 7:30am");

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/3 draft events/i);
      expect(screen.getByTestId("calendar-event-editor-mode-create")).toBe(composerBody);
    });
  });

  it("renders recurrence UI for recurring NLP and saves structured recurrence", async () => {
    const { refreshRange, upsertEvents } = renderEventEditor();
    mockCreateCalendarEvent.mockResolvedValue({
      event: {
        id: "series-1",
        title: "Work",
        accountId: "gmail-main",
        calendarId: "primary",
        startMs: new Date("2026-04-20T10:00:00.000Z").getTime(),
        endMs: new Date("2026-04-20T15:00:00.000Z").getTime(),
        writable: true,
        allDay: false,
        isRecurring: true,
      },
    });

    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    commitTitleWithoutWallClock("Work at 3am to 8am every monday");

    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/apr 20, 2026/i);
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/every mon/i);
      expect(screen.queryByTestId("calendar-event-title-mode-preview")).toBeNull();
      expect(screen.queryByTestId("calendar-recurrence-section")).toBeNull();
      expect((screen.getByTestId("calendar-event-save") as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByTestId("calendar-event-save").textContent).toMatch(/create recurring event/i);
    });

    fireEvent.click(getActiveRepeatTrigger(/repeat/i));
    const repeatPicker = await screen.findByRole("dialog", { name: /recurrence picker/i });
    expect(repeatPicker).toBeTruthy();
    fireEvent.change(within(repeatPicker).getByTestId("calendar-recurrence-frequency"), {
      target: { value: "monthly" },
    });
    fireEvent.change(within(repeatPicker).getByTestId("calendar-recurrence-interval"), {
      target: { value: "2" },
    });
    fireEvent.change(within(repeatPicker).getByTestId("calendar-recurrence-ends-type"), {
      target: { value: "onDate" },
    });
    fireEvent.click(await within(repeatPicker).findByTestId("calendar-recurrence-until-date"));
    fireEvent.click(within(await screen.findByLabelText("Recurrence end date picker")).getByRole("button", { name: "24" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Recurrence end date picker")).toBeNull();
      expect(within(repeatPicker).getByTestId("calendar-recurrence-until-date").textContent).toMatch(/apr 24, 2026/i);
    });

    fireEvent.click(getActiveEventSaveButton());

    await waitFor(() => {
      expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
      expect(refreshRange).toHaveBeenCalledWith("2026-04-20", "2026-04-20");
      expect(upsertEvents).not.toHaveBeenCalled();
    });
  });

  it("keeps the editor open when selecting a recurrence ends option from the floating listbox", async () => {
    renderEventEditor();
    expect(await screen.findByTestId("calendar-event-editor-rail")).toBeTruthy();
    commitTitleWithoutWallClock("Work at 3am to 8am every monday");
    await waitFor(() => {
      expect(screen.getByTestId("calendar-draft-preview-summary").textContent).toMatch(/every mon/i);
    });

    fireEvent.click(getActiveRepeatTrigger(/repeat/i));
    const repeatPicker = await screen.findByRole("dialog", { name: /recurrence picker/i });
    const recurrenceSection = within(repeatPicker).getByTestId("calendar-recurrence-section");
    expect(recurrenceSection).toBeTruthy();

    fireEvent.click(within(recurrenceSection).getByRole("button", { name: /^never$/i }));
    const endsListbox = screen.getByRole("listbox", { name: /select option/i });
    expect(endsListbox).toBeTruthy();

    fireEvent.click(within(endsListbox).getByRole("option", { name: /on date/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect((within(repeatPicker).getByTestId("calendar-recurrence-ends-type") as HTMLInputElement).value).toBe("onDate");
      expect(within(repeatPicker).getByTestId("calendar-recurrence-until-date")).toBeTruthy();
    });

    fireEvent.click(within(repeatPicker).getByTestId("calendar-recurrence-until-date"));
    fireEvent.click(within(await screen.findByLabelText("Recurrence end date picker")).getByRole("button", { name: "25" }));

    await waitFor(() => {
      expect(screen.getByTestId("calendar-event-editor-rail")).toBeTruthy();
      expect(screen.queryByLabelText("Recurrence end date picker")).toBeNull();
      expect(within(repeatPicker).getByTestId("calendar-recurrence-until-date").textContent).toMatch(/apr 25, 2026/i);
    });
  });
});
