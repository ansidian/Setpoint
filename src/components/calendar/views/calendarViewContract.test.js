import { describe, expect, it } from "vitest";
import billsView from "./billsView.jsx";
import eventsView from "./eventsView.jsx";

describe("calendar view contract", () => {
  it("does not expose the retired footer surface", () => {
    expect(billsView).not.toHaveProperty("renderFooter");
    expect(eventsView).not.toHaveProperty("renderFooter");
  });
});
