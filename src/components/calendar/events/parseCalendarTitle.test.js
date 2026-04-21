import { describe, expect, it } from "vitest";
import { parseCalendarTitle } from "./parseCalendarTitle";

describe("parseCalendarTitle", () => {
  it("consumes date/time tokens from the title and builds a schedule preview", () => {
    const parsed = parseCalendarTitle("Dinner on Tue at 5pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.cleanTitle).toBe("Dinner");
    expect(parsed.mode).toBe("single");
    expect(parsed.locationQuery).toBe("");
    expect(parsed.parsedDateTime).toMatchObject({
      startDate: "2026-04-21",
      endDate: "2026-04-21",
      startTime: "17:00",
      endTime: "17:30",
    });
    expect(parsed.preview).toMatch(/Tue, Apr 21, 2026/i);
  });

  it("uses the selected day as the fallback date for bare times", () => {
    const parsed = parseCalendarTitle("Dinner 5pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-29",
    });

    expect(parsed.cleanTitle).toBe("Dinner");
    expect(parsed.mode).toBe("single");
    expect(parsed.parsedDateTime).toMatchObject({
      startDate: "2026-04-29",
      endDate: "2026-04-29",
      startTime: "17:00",
      endTime: "17:30",
    });
  });

  it("extracts a trailing location query after removing time tokens", () => {
    const parsed = parseCalendarTitle("Dinner @McDonald's tomorrow 5pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.cleanTitle).toBe("Dinner");
    expect(parsed.locationQuery).toBe("McDonald's");
    expect(parsed.parsedDateTime).toMatchObject({
      startDate: "2026-04-21",
      startTime: "17:00",
    });
  });

  it("does not let @location consume trailing time tokens", () => {
    const parsed = parseCalendarTitle("Dinner @McDonald's at 5pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.cleanTitle).toBe("Dinner");
    expect(parsed.locationQuery).toBe("McDonald's");
    expect(parsed.parsedDateTime).toMatchObject({
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      startTime: "17:00",
      endTime: "17:30",
    });
    expect(parsed.titleAfterLocationCommit).toBe("Dinner at 5pm ");
  });

  it("does not treat plain 'at' as a location producer", () => {
    const parsed = parseCalendarTitle("Dinner at McDonald's tomorrow 5pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.locationQuery).toBe("");
  });

  it("extracts a trailing calendar source query", () => {
    const parsed = parseCalendarTitle("Dinner tomorrow 5pm cal personal", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.cleanTitle).toBe("Dinner");
    expect(parsed.sourceQuery).toBe("personal");
    expect(parsed.titleAfterSourceCommit).toBe("Dinner tomorrow 5pm ");
  });

  it("does not let @location consume trailing source tokens", () => {
    const parsed = parseCalendarTitle("Dinner 5pm @McDonald's cal school", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.cleanTitle).toBe("Dinner");
    expect(parsed.locationQuery).toBe("McDonald's");
    expect(parsed.sourceQuery).toBe("school");
    expect(parsed.parsedDateTime).toMatchObject({
      startTime: "17:00",
      endTime: "17:30",
    });
  });

  it("does not let cal consume trailing time tokens", () => {
    const parsed = parseCalendarTitle("Dinner cal school at 2pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.cleanTitle).toBe("Dinner");
    expect(parsed.sourceQuery).toBe("school");
    expect(parsed.parsedDateTime).toMatchObject({
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      startTime: "14:00",
      endTime: "14:30",
    });
    expect(parsed.titleAfterSourceCommit).toBe("Dinner at 2pm ");
  });

  it("does not let cal with no source name consume the following temporal token", () => {
    const parsed = parseCalendarTitle("Dinner cal at 2pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });
    expect(parsed.sourceQuery).toBe("");
    expect(parsed.parsedDateTime).toMatchObject({ startTime: "14:00" });
  });

  it("keeps live source and location queries trimmed while typing temporal suffixes", () => {
    const locationParsed = parseCalendarTitle("Dinner @McDonald's at", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });
    const sourceParsed = parseCalendarTitle("Dinner cal school at", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(locationParsed.locationQuery).toBe("McDonald's");
    expect(sourceParsed.sourceQuery).toBe("school");
  });

  it("parses enumerated weekdays into batch one-off drafts", () => {
    const parsed = parseCalendarTitle("Work next tue, wed, thur at 4:15am to 7:30am", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
      defaultStartTime: "09:00",
      defaultEndTime: "09:30",
    });

    expect(parsed.mode).toBe("batch");
    expect(parsed.cleanTitle).toBe("Work");
    expect(parsed.batchDrafts).toEqual([
      expect.objectContaining({
        title: "Work",
        startDate: "2026-04-28",
        endDate: "2026-04-28",
        startTime: "04:15",
        endTime: "07:30",
      }),
      expect.objectContaining({
        startDate: "2026-04-29",
        endDate: "2026-04-29",
      }),
      expect.objectContaining({
        startDate: "2026-04-30",
        endDate: "2026-04-30",
      }),
    ]);
    expect(parsed.singleDraft).toMatchObject({
      startDate: "2026-04-28",
      startTime: "04:15",
    });
  });

  it("parses weekly recurring phrases into a structured recurrence draft", () => {
    const parsed = parseCalendarTitle("Work at 3am to 8am every monday", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
      defaultStartTime: "09:00",
      defaultEndTime: "09:30",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Work");
    expect(parsed.singleDraft).toMatchObject({
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      startTime: "03:00",
      endTime: "08:00",
    });
    expect(parsed.recurrenceDraft).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO"],
      ends: { type: "never" },
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      startTime: "03:00",
      endTime: "08:00",
    });
  });

  it("parses recurring intent when temporal tokens precede the every clause", () => {
    const parsed = parseCalendarTitle("Work at 3am to 8am every monday", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
      defaultStartTime: "09:00",
      defaultEndTime: "09:30",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Work");
    expect(parsed.singleDraft).toMatchObject({
      startTime: "03:00",
      endTime: "08:00",
    });
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "weekly",
      weekdays: ["MO"],
    });
  });

  it("parses recurring intent with every clause in the middle", () => {
    const parsed = parseCalendarTitle("Work every friday at 9am", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Work");
    expect(parsed.singleDraft).toMatchObject({
      startTime: "09:00",
      endTime: "09:30",
    });
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "weekly",
      weekdays: ["FR"],
    });
  });

  it("parses batch intent when temporal tokens precede the weekday list", () => {
    const parsed = parseCalendarTitle("Work at 4:15am to 7:30am next tue, wed, thur", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
      defaultStartTime: "09:00",
      defaultEndTime: "09:30",
    });

    expect(parsed.mode).toBe("batch");
    expect(parsed.cleanTitle).toBe("Work");
    expect(parsed.batchDrafts).toHaveLength(3);
    expect(parsed.batchDrafts[0]).toMatchObject({
      startDate: "2026-04-28",
      startTime: "04:15",
      endTime: "07:30",
    });
  });

  it("parses 'every day' into a daily recurring draft", () => {
    const parsed = parseCalendarTitle("Standup every day at 9am", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Standup");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "daily",
      interval: 1,
      weekdays: [],
    });
    expect(parsed.singleDraft).toMatchObject({ startTime: "09:00" });
  });

  it("parses 'daily' standalone keyword into a daily recurring draft", () => {
    const parsed = parseCalendarTitle("Standup daily at 9am", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Standup");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "daily",
      interval: 1,
    });
  });

  it("parses 'every month' into a monthly recurring draft", () => {
    const parsed = parseCalendarTitle("Rent every month", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Rent");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "monthly",
      interval: 1,
      weekdays: [],
    });
  });

  it("parses 'yearly' into a yearly recurring draft", () => {
    const parsed = parseCalendarTitle("Birthday yearly", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Birthday");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "yearly",
      interval: 1,
    });
  });

  it("parses 'every other monday' into a biweekly recurring draft", () => {
    const parsed = parseCalendarTitle("Sync every other monday at 10am", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Sync");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "weekly",
      interval: 2,
      weekdays: ["MO"],
    });
    expect(parsed.singleDraft).toMatchObject({ startTime: "10:00" });
  });

  it("parses 'every 2 weeks' into a biweekly recurring draft", () => {
    const parsed = parseCalendarTitle("Review every 2 weeks at 3pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Review");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "weekly",
      interval: 2,
    });
    expect(parsed.singleDraft).toMatchObject({ startTime: "15:00" });
  });

  it("parses 'every 3 months' into a quarterly recurring draft", () => {
    const parsed = parseCalendarTitle("Quarterly review every 3 months", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Quarterly review");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "monthly",
      interval: 3,
      weekdays: [],
    });
  });

  it("parses 'biweekly' into a weekly interval-2 recurring draft", () => {
    const parsed = parseCalendarTitle("Team sync biweekly at 2pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("Team sync");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "weekly",
      interval: 2,
    });
    expect(parsed.singleDraft).toMatchObject({ startTime: "14:00" });
  });

  it("parses 'first monday of every month' into a monthly recurring draft", () => {
    const parsed = parseCalendarTitle("All hands first monday of every month at 10am", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("recurring");
    expect(parsed.cleanTitle).toBe("All hands");
    expect(parsed.recurrenceDraft).toMatchObject({
      frequency: "monthly",
      interval: 1,
    });
    expect(parsed.singleDraft).toMatchObject({ startTime: "10:00" });
  });

  it("parses repeated-qualifier weekday lists into batch drafts", () => {
    const parsed = parseCalendarTitle("Work at 4:15a to 8am next tue, next wed, next thu", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
      defaultStartTime: "09:00",
      defaultEndTime: "09:30",
    });

    expect(parsed.mode).toBe("batch");
    expect(parsed.cleanTitle).toBe("Work");
    expect(parsed.batchDrafts).toHaveLength(3);
    expect(parsed.batchDrafts[0]).toMatchObject({
      startDate: "2026-04-28",
      startTime: "04:15",
      endTime: "08:00",
    });
    expect(parsed.batchDrafts[1]).toMatchObject({ startDate: "2026-04-29" });
    expect(parsed.batchDrafts[2]).toMatchObject({ startDate: "2026-04-30" });
  });

  it("parses bare weekday lists without a qualifier into batch drafts", () => {
    const parsed = parseCalendarTitle("Work tue, wed, thu at 9am", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("batch");
    expect(parsed.cleanTitle).toBe("Work");
    expect(parsed.batchDrafts).toHaveLength(3);
    expect(parsed.batchDrafts[0]).toMatchObject({ startTime: "09:00" });
  });

  it("parses mixed qualifier weekday lists into batch drafts", () => {
    const parsed = parseCalendarTitle("Work this tue, next thu at 2pm", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("batch");
    expect(parsed.cleanTitle).toBe("Work");
    expect(parsed.batchDrafts).toHaveLength(2);
  });

  it("parses explicit date lists into batch one-off drafts", () => {
    const parsed = parseCalendarTitle("Work 4/21, 4/22 at 4:15am to 7:30am", {
      now: new Date("2026-04-20T19:00:00.000Z").getTime(),
      baseDate: "2026-04-20",
    });

    expect(parsed.mode).toBe("batch");
    expect(parsed.cleanTitle).toBe("Work");
    expect(parsed.batchDrafts).toEqual([
      expect.objectContaining({
        startDate: "2026-04-21",
        endDate: "2026-04-21",
      }),
      expect.objectContaining({
        startDate: "2026-04-22",
        endDate: "2026-04-22",
      }),
    ]);
  });
});
