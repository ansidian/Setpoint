import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "./publicAsset.js";

describe("publicAssetUrl", () => {
  it("prefixes public assets with the deployment base path", () => {
    expect(publicAssetUrl("setpoint.svg", "/")).toBe("/setpoint.svg");
    expect(publicAssetUrl("/setpoint.svg", "/Setpoint/")).toBe("/Setpoint/setpoint.svg");
  });
});
