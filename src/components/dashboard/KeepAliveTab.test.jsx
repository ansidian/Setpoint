import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import KeepAliveTab from "./KeepAliveTab.jsx";

function Probe({ label }) {
  return <div data-testid="probe">{label}</div>;
}

describe("KeepAliveTab", () => {
  afterEach(cleanup);

  it("freezes an inactive tab across parent re-renders, then refreshes it on activate", () => {
    const { rerender, getByTestId } = render(
      <KeepAliveTab active={false}><Probe label="v1" /></KeepAliveTab>,
    );
    expect(getByTestId("probe").textContent).toBe("v1");

    // Parent re-renders with new child props while the tab stays hidden. A
    // frozen tab ignores the update entirely, so it still shows its old output —
    // had it reconciled, the text would be "v2".
    rerender(<KeepAliveTab active={false}><Probe label="v2" /></KeepAliveTab>);
    expect(getByTestId("probe").textContent).toBe("v1");

    // Becoming active snaps straight to the latest props.
    rerender(<KeepAliveTab active={true}><Probe label="v3" /></KeepAliveTab>);
    expect(getByTestId("probe").textContent).toBe("v3");
  });

  it("keeps the active tab in sync with parent re-renders", () => {
    const { rerender, getByTestId } = render(
      <KeepAliveTab active={true}><Probe label="a" /></KeepAliveTab>,
    );
    expect(getByTestId("probe").textContent).toBe("a");

    rerender(<KeepAliveTab active={true}><Probe label="b" /></KeepAliveTab>);
    expect(getByTestId("probe").textContent).toBe("b");
  });
});
