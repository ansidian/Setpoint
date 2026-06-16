import { describe, expect, it } from "vitest";
import { formatModelName, mappingStatusLabel } from "./helpers";

describe("formatModelName", () => {
  it("returns Claude family/version for Anthropic model ids", () => {
    expect(formatModelName("claude-haiku-4-5")).toBe("Haiku 4.5");
    expect(formatModelName("claude-sonnet-4-6")).toBe("Sonnet 4.6");
  });

  it("returns GPT family for OpenAI GPT-5 variants instead of falling back to Claude", () => {
    expect(formatModelName("gpt-5.5")).toBe("GPT-5.5");
    expect(formatModelName("gpt-5.4")).toBe("GPT-5.4");
    expect(formatModelName("gpt-5.4-mini")).toBe("GPT-5.4 mini");
    expect(formatModelName("gpt-5.4-nano")).toBe("GPT-5.4 nano");
  });

  it("falls back to the raw id for unknown models rather than mislabeling as Claude", () => {
    expect(formatModelName("some-future-model")).toBe("some-future-model");
  });

  it("returns Claude only when no model is supplied", () => {
    expect(formatModelName(null)).toBe("Claude");
    expect(formatModelName("")).toBe("Claude");
  });
});

describe("mappingStatusLabel", () => {
  it("shows the loading placeholder regardless of mapping while loading", () => {
    expect(mappingStatusLabel(null, true)).toBe("Mapping...");
    expect(mappingStatusLabel({ status: "matched", profileId: "edison" }, true)).toBe("Mapping...");
  });

  it("returns null when there is no mapping status and not loading", () => {
    expect(mappingStatusLabel(null, false)).toBeNull();
    expect(mappingStatusLabel(undefined, false)).toBeNull();
    expect(mappingStatusLabel({}, false)).toBeNull();
  });

  it("assembles the matched label from the available parts", () => {
    expect(
      mappingStatusLabel(
        { status: "matched", profileId: "edison", behaviorId: "monthly", amountSource: "blank" },
        false,
      ),
    ).toBe("Mapped: edison · monthly · amount missing");
  });

  it("omits matched parts that are absent", () => {
    expect(mappingStatusLabel({ status: "matched" }, false)).toBe("Mapped:");
    expect(mappingStatusLabel({ status: "matched", profileId: "edison" }, false)).toBe("Mapped: edison");
    expect(
      mappingStatusLabel({ status: "matched", profileId: "edison", behaviorId: "monthly" }, false),
    ).toBe("Mapped: edison · monthly");
    expect(
      mappingStatusLabel({ status: "matched", profileId: "edison", amountSource: "blank" }, false),
    ).toBe("Mapped: edison · amount missing");
  });

  it("maps each non-matched status to its review copy", () => {
    expect(mappingStatusLabel({ status: "identity_only" }, false)).toBe("Identity match: choose bill details");
    expect(mappingStatusLabel({ status: "unmapped" }, false)).toBe("Unmapped: review fields manually");
    expect(mappingStatusLabel({ status: "invalid_target" }, false)).toBe("Mapping needs review: Actual target changed");
    expect(mappingStatusLabel({ status: "incomplete_mapping" }, false)).toBe("Mapping incomplete: review fields manually");
  });

  it("returns null for an unrecognized status", () => {
    expect(mappingStatusLabel({ status: "something_else" }, false)).toBeNull();
  });
});
