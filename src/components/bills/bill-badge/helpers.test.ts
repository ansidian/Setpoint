import { describe, expect, it } from "vitest";
import { formatModelName } from "./helpers";

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
