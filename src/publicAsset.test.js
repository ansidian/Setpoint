import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "./publicAsset.js";

describe("publicAssetUrl", () => {
  it("prefixes public assets with the deployment base path", () => {
    expect(publicAssetUrl("ea-dashboard-mark-v3.svg", "/")).toBe("/ea-dashboard-mark-v3.svg");
    expect(publicAssetUrl("/ea-dashboard-mark-v3.svg", "/ea-dashboard/")).toBe("/ea-dashboard/ea-dashboard-mark-v3.svg");
  });
});
