import { describe, expect, it } from "vitest";
import { ALFRED_MODELS, DEFAULT_ALFRED_MODEL, resolveAlfredModel } from "./alfred-models.js";

describe("resolveAlfredModel", () => {
  it("returns the default when nothing requested", () => {
    expect(resolveAlfredModel(undefined)).toBe(DEFAULT_ALFRED_MODEL);
    expect(resolveAlfredModel("")).toBe(DEFAULT_ALFRED_MODEL);
  });

  it("accepts exactly the allowlisted ids", () => {
    for (const model of ALFRED_MODELS) {
      expect(resolveAlfredModel(model.id)).toBe(model.id);
    }
  });

  it("rejects unknown ids", () => {
    expect(resolveAlfredModel("gpt-5.5")).toBeNull();
    expect(resolveAlfredModel("claude-opus-4-8")).toBeNull();
  });
});
