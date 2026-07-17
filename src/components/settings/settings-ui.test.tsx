import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsLayout } from "./settings-ui";
import { TABS } from "./settings-core";
import type { ComponentProps } from "react";

function renderLayout(props: Omit<ComponentProps<typeof SettingsLayout>, "children">) {
  return render(
    <MemoryRouter>
      <SettingsLayout {...props}>
        <div>content</div>
      </SettingsLayout>
    </MemoryRouter>,
  );
}

describe("SettingsLayout read-only skeleton path (no onTabChange)", () => {
  afterEach(cleanup);

  it("exposes disabled, non-interactive tabs in the same tablist/tab shape as the loaded state", () => {
    renderLayout({ activeTab: TABS[0].id });

    const tablist = screen.getByRole("tablist", { name: "Settings sections" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(TABS.length);

    for (const tab of tabs) {
      expect(tab.getAttribute("aria-disabled")).toBe("true");
      expect(tab.tagName).toBe("DIV");
    }

    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toBe(TABS[0].label);
  });

  it("still exposes a labelled tabpanel for the active section", () => {
    renderLayout({ activeTab: TABS[1].id });

    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe(TABS[1].label);
  });
});
