import { describe, expect, it } from "vitest";
import { extractDescriptionUrls } from "./descriptionLinksModel";

describe("extractDescriptionUrls", () => {
  it("extracts unique clickable URLs without sentence punctuation", () => {
    expect(extractDescriptionUrls([
      "Source: https://mail.google.com/mail/u/0/#inbox/abc.",
      "More: https://example.com/path?q=1",
      "Again: https://example.com/path?q=1",
    ].join("\n"))).toEqual([
      "https://mail.google.com/mail/u/0/#inbox/abc",
      "https://example.com/path?q=1",
    ]);
  });
});
