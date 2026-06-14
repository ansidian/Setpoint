import { describe, expect, it } from "vitest";
import {
  validateEmailInterests,
  validateImportantSenders,
  validateSchedules,
} from "./settings-schemas.js";

describe("schedules_json schema", () => {
  it("accepts a well-formed schedule list (array or JSON string)", () => {
    const schedules = [
      { label: "Morning Briefing", time: "08:00", enabled: true, tz: "America/Los_Angeles" },
      { label: "Evening Briefing", time: "20:30", enabled: false },
    ];
    expect(validateSchedules(schedules)).toEqual({ valid: true, value: schedules });
    expect(validateSchedules(JSON.stringify(schedules))).toEqual({ valid: true, value: schedules });
    expect(validateSchedules([])).toEqual({ valid: true, value: [] });
  });

  it("accepts skipped_until date strings and unknown extra keys on legacy rows", () => {
    const schedules = [{
      label: "Morning",
      time: "8:00",
      enabled: true,
      skipped_until: "2026-06-11T07:00:00.000Z",
      legacy_field: "ignored",
    }];
    expect(validateSchedules(schedules)).toEqual({ valid: true, value: schedules });
  });

  it("rejects malformed JSON, non-arrays, and bad entries with field-specific messages", () => {
    expect(validateSchedules("{not json")).toEqual({
      valid: false,
      message: "Invalid schedules_json: not valid JSON",
    });
    expect(validateSchedules({ label: "Morning" })).toEqual({
      valid: false,
      message: "Invalid schedules_json: must be an array",
    });
    expect(validateSchedules(null)).toEqual({
      valid: false,
      message: "Invalid schedules_json: must be an array",
    });
    expect(validateSchedules(["morning"])).toEqual({
      valid: false,
      message: "Invalid schedules_json entry: must be an object",
    });
    expect(validateSchedules([{ time: "08:00", enabled: true }])).toEqual({
      valid: false,
      message: "Invalid schedules_json entry: label must be a non-empty string",
    });
    expect(validateSchedules([{ label: "Morning", time: "25:00", enabled: true }])).toEqual({
      valid: false,
      message: "Invalid schedules_json entry: time must be HH:MM (24h)",
    });
    expect(validateSchedules([{ label: "Morning", time: "08:00", enabled: "yes" }])).toEqual({
      valid: false,
      message: "Invalid schedules_json entry: enabled must be a boolean",
    });
    expect(validateSchedules([{ label: "Morning", time: "08:00", enabled: true, tz: "Mars/Olympus" }])).toEqual({
      valid: false,
      message: "Invalid schedules_json entry: tz must be a valid IANA timezone",
    });
    expect(validateSchedules([{ label: "Morning", time: "08:00", enabled: true, skipped_until: "someday" }])).toEqual({
      valid: false,
      message: "Invalid schedules_json entry: skipped_until must be a date string",
    });
  });
});

describe("email_interests_json schema", () => {
  it("accepts a list of non-empty strings (array or JSON string)", () => {
    const interests = ["ai infrastructure", "sf housing"];
    expect(validateEmailInterests(interests)).toEqual({ valid: true, value: interests });
    expect(validateEmailInterests(JSON.stringify(interests))).toEqual({ valid: true, value: interests });
    expect(validateEmailInterests([])).toEqual({ valid: true, value: [] });
  });

  it("rejects malformed JSON, non-arrays, and blank or non-string entries", () => {
    expect(validateEmailInterests("{not json")).toEqual({
      valid: false,
      message: "Invalid email_interests_json: not valid JSON",
    });
    expect(validateEmailInterests('"topic"')).toEqual({
      valid: false,
      message: "Invalid email_interests_json: must be an array",
    });
    expect(validateEmailInterests([" "])).toEqual({
      valid: false,
      message: "Invalid email_interests_json entry: must be a non-empty string",
    });
    expect(validateEmailInterests([{ topic: "ai" }])).toEqual({
      valid: false,
      message: "Invalid email_interests_json entry: must be a non-empty string",
    });
  });
});

describe("important senders schema", () => {
  it("accepts manual and auto sender entries", () => {
    const senders = [
      { address: "boss@company.com", name: "boss", source: "manual" },
      { address: "alerts@bank.com", source: "auto" },
      { address: "plain@example.com" },
    ];
    expect(validateImportantSenders(senders)).toEqual({ valid: true, value: senders });
    expect(validateImportantSenders([])).toEqual({ valid: true, value: [] });
  });

  it("rejects non-arrays, malformed entries, and duplicate addresses", () => {
    expect(validateImportantSenders("boss@company.com")).toEqual({
      valid: false,
      message: "senders must be an array",
    });
    expect(validateImportantSenders(["boss@company.com"])).toEqual({
      valid: false,
      message: "Invalid senders entry: must be an object",
    });
    expect(validateImportantSenders([{ name: "boss" }])).toEqual({
      valid: false,
      message: "Invalid senders entry: address must be an email address",
    });
    expect(validateImportantSenders([{ address: "not-an-email" }])).toEqual({
      valid: false,
      message: "Invalid senders entry: address must be an email address",
    });
    expect(validateImportantSenders([{ address: "boss@company.com", name: 7 }])).toEqual({
      valid: false,
      message: "Invalid senders entry: name must be a string",
    });
    expect(validateImportantSenders([{ address: "boss@company.com", source: "guessed" }])).toEqual({
      valid: false,
      message: 'Invalid senders entry: source must be "manual" or "auto"',
    });
    expect(validateImportantSenders([
      { address: "boss@company.com" },
      { address: "Boss@Company.com" },
    ])).toEqual({
      valid: false,
      message: "Duplicate sender address: boss@company.com",
    });
  });
});
