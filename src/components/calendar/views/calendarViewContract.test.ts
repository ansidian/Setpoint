import { describe, expect, it } from "vitest";
import billsView from "./billsView.tsx";
import eventsView from "./eventsView.tsx";

describe("calendar view contract", () => {
  it("does not expose the retired footer surface", () => {
    expect(billsView).not.toHaveProperty("renderFooter");
    expect(eventsView).not.toHaveProperty("renderFooter");
  });
});
