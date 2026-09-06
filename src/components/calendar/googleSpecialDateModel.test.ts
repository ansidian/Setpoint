import { describe, expect, it } from "vitest";
import {
  googleSpecialDateLabel,
  isGoogleSpecialDateEvent
} from "./googleSpecialDateModel.ts";

describe("googleSpecialDateModel", () => {
  it("identifies Google birthday event records and search results as special date markers", () => {
    expect(isGoogleSpecialDateEvent({
      eventType: "birthday",
      birthdayProperties: { type: "birthday" },
    })).toBe(true);

    expect(isGoogleSpecialDateEvent({
      type: "event",
      sourceLabel: "Birthdays",
    })).toBe(true);

    expect(isGoogleSpecialDateEvent({
      type: "deadline",
      sourceLabel: "Birthdays",
    })).toBe(false);
  });

  it("labels supported Google special date variants without changing provider titles", () => {
    expect(googleSpecialDateLabel({
      eventType: "birthday",
      birthdayProperties: { type: "birthday" },
    })).toBe("Birthday");

    expect(googleSpecialDateLabel({
      eventType: "birthday",
      birthdayProperties: { type: "anniversary" },
    })).toBe("Anniversary");

    expect(googleSpecialDateLabel({
      eventType: "birthday",
      birthdayProperties: { type: "custom", customTypeName: "Gotcha day" },
    })).toBe("Gotcha day");

    expect(googleSpecialDateLabel({
      eventType: "birthday",
      birthdayProperties: { type: "other" },
    })).toBe("Special date");
  });
});
