import { describe, it, expect } from "vitest";
import { buildPayLinksByScheduleId } from "./useUtilityPayLinks.js";

describe("buildPayLinksByScheduleId", () => {
  it("maps scheduleId to url for complete entries", () => {
    const map = buildPayLinksByScheduleId([
      { scheduleId: "s1", url: "https://a", label: "Electricity" },
      { scheduleId: "s2", url: "https://b", label: "Water" },
    ]);
    expect(map).toEqual({ s1: "https://a", s2: "https://b" });
  });

  it("skips entries missing scheduleId or url", () => {
    const map = buildPayLinksByScheduleId([
      { scheduleId: "", url: "https://a" },
      { scheduleId: "s2" },
      { scheduleId: "s3", url: "https://c" },
    ]);
    expect(map).toEqual({ s3: "https://c" });
  });

  it("returns an empty object for non-arrays", () => {
    expect(buildPayLinksByScheduleId(null)).toEqual({});
    expect(buildPayLinksByScheduleId(undefined)).toEqual({});
  });
});
