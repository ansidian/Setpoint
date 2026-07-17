import { describe, expect, it } from "vitest";
import { hasRemoteImageRefs } from "./remoteContentDetection";

describe("hasRemoteImageRefs", () => {
  it("detects a remote https image", () => {
    expect(hasRemoteImageRefs('<img src="https://cdn.example/banner.png">')).toBe(true);
  });

  it("ignores a plain http image (widened CSP only allows https)", () => {
    expect(hasRemoteImageRefs('<img src="http://cdn.example/banner.png">')).toBe(false);
  });

  it("is case-insensitive on the tag and scheme", () => {
    expect(hasRemoteImageRefs('<IMG SRC="HTTPS://cdn.example/banner.png">')).toBe(true);
  });

  it("ignores data: URI images", () => {
    expect(hasRemoteImageRefs('<img src="data:image/png;base64,aaaa">')).toBe(false);
  });

  it("returns false when there is no <img> at all", () => {
    expect(hasRemoteImageRefs("<p>just text</p>")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(hasRemoteImageRefs("")).toBe(false);
  });

  it("defaults to false when called with no argument", () => {
    expect(hasRemoteImageRefs()).toBe(false);
  });
});
