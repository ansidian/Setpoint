import { describe, expect, it } from "vitest";
import {
  extractNonZoomEventUrl,
  extractUrlsFromText,
  extractZoomMeetingUrl,
  getLocationDisplayLabel,
  isZoomUrl,
  stripUrlsFromText,
} from "./calendar-links";

describe("calendar-links", () => {
  it("extracts URLs and strips trailing punctuation", () => {
    expect(
      extractUrlsFromText("Join here: https://calstatela.zoom.us/j/81820730704)."),
    ).toEqual(["https://calstatela.zoom.us/j/81820730704"]);
  });

  it("extracts and decodes URLs from HTML href attributes", () => {
    expect(
      extractUrlsFromText('<a href="https://example.com/path?one=1&amp;two=2">Open portal</a>'),
    ).toEqual(["https://example.com/path?one=1&two=2"]);
  });

  it("normalizes bare URLs from event text", () => {
    expect(
      extractUrlsFromText("Canvas link canvas.calstatela.edu/courses/123/assignments/456"),
    ).toEqual(["https://canvas.calstatela.edu/courses/123/assignments/456"]);
  });

  it("normalizes uncommon bare domains with paths", () => {
    expect(extractUrlsFromText("Stream twitch.tv/pathofexile")).toEqual([
      "https://twitch.tv/pathofexile",
    ]);
  });

  it("normalizes an exact bare domain field", () => {
    expect(extractUrlsFromText("twitch.tv")).toEqual(["https://twitch.tv/"]);
  });

  it("does not treat incidental bare domains in prose as event URLs", () => {
    expect(extractUrlsFromText("Discuss example.com strategy in room B")).toEqual([]);
  });

  it("strips URLs from text while preserving surrounding copy", () => {
    expect(
      stripUrlsFromText("Zoom link https://calstatela.zoom.us/j/81820730704 for office hours"),
    ).toBe("Zoom link for office hours");
  });

  it("accepts vanity Zoom subdomains", () => {
    expect(isZoomUrl("https://calstatela.zoom.us/j/81820730704")).toBe(true);
  });

  it("rejects non-Zoom hosts", () => {
    expect(isZoomUrl("https://example.com/zoom.us/j/81820730704")).toBe(false);
  });

  it("prefers a Zoom URL from location before description", () => {
    expect(
      extractZoomMeetingUrl({
        location: "https://calstatela.zoom.us/j/81820730704",
        description: "Backup: https://zoom.us/j/99999999999",
      }),
    ).toBe("https://calstatela.zoom.us/j/81820730704");
  });

  it("falls back to description when location has no Zoom link", () => {
    expect(
      extractZoomMeetingUrl({
        location: "Conference Room B",
        description: "Zoom notes https://zoom.us/j/12345678901?pwd=abc",
      }),
    ).toBe("https://zoom.us/j/12345678901?pwd=abc");
  });

  it("extracts the first non-Zoom event URL from location before description and notes", () => {
    expect(
      extractNonZoomEventUrl({
        location: "Room notes https://example.com/room",
        description: "Backup https://docs.example.com/agenda",
        notes: "Later https://notion.example.com/page",
      }),
    ).toBe("https://example.com/room");
  });

  it("extracts a bare non-Zoom URL from location", () => {
    expect(
      extractNonZoomEventUrl({
        location: "canvas.calstatela.edu/courses/123/assignments/456",
        description: "Backup https://docs.example.com/agenda",
      }),
    ).toBe("https://canvas.calstatela.edu/courses/123/assignments/456");
  });

  it("skips Zoom links when extracting a general event URL", () => {
    expect(
      extractNonZoomEventUrl({
        location: "https://calstatela.zoom.us/j/81820730704",
        description: "Agenda https://docs.example.com/agenda.",
      }),
    ).toBe("https://docs.example.com/agenda");
  });

  it("unwraps Google redirect links for the general event URL", () => {
    expect(
      extractNonZoomEventUrl({
        description: '<a href="https://www.google.com/url?q=https%3A%2F%2Fdocs.example.com%2Fagenda%3Fx%3D1%26y%3D2&amp;sa=D">Agenda</a>',
      }),
    ).toBe("https://docs.example.com/agenda?x=1&y=2");
  });

  it("skips Google Calendar source links for the general event URL", () => {
    expect(
      extractNonZoomEventUrl({
        description: "Source https://calendar.google.com/calendar/u/0/r/eventedit/abc123 then docs https://docs.example.com/agenda",
      }),
    ).toBe("https://docs.example.com/agenda");
  });

  it("returns null when only Zoom links are present for the general URL", () => {
    expect(
      extractNonZoomEventUrl({
        location: "calstatela.zoom.us/j/81820730704",
        notes: "Backup https://zoom.us/j/12345678901",
      }),
    ).toBeNull();
  });

  it("returns a clean Zoom subtitle label when the location is only a Zoom URL", () => {
    expect(getLocationDisplayLabel("https://calstatela.zoom.us/j/81820730704")).toBe("Zoom meeting");
  });

  it("keeps non-URL location text around a Zoom URL", () => {
    expect(
      getLocationDisplayLabel("Zoom link https://calstatela.zoom.us/j/81820730704 for office hours"),
    ).toBe("Zoom link for office hours");
  });
});
