import { expect, test } from "@playwright/test";
import { installDashboardCalendarLayoutFixtures } from "./support/dashboard-fixtures.js";

async function openCalendar(page) {
  await page.goto("/");
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible();
}

async function inlineStyle(locator, property) {
  return locator.evaluate((node, name) => node.style[name], property);
}

test("uses the wide desktop rail layout and reflows when the viewport shrinks", async ({ page }) => {
  await installDashboardCalendarLayoutFixtures(page);
  await page.setViewportSize({ width: 1900, height: 1200 });

  await openCalendar(page);

  const panel = page.getByTestId("calendar-modal-panel");
  const body = page.getByTestId("calendar-modal-body");
  const rail = page.getByTestId("calendar-modal-rail");

  await expect.poll(() => inlineStyle(panel, "maxWidth")).toBe("1560px");
  await expect.poll(() => inlineStyle(panel, "width")).toMatch(/80px/);
  await expect.poll(() => inlineStyle(body, "gridTemplateColumns")).toContain("420px");
  await expect.poll(() => inlineStyle(rail, "position")).toBe("sticky");

  await page.setViewportSize({ width: 1240, height: 1000 });

  await expect.poll(() => inlineStyle(panel, "maxWidth")).toBe("1180px");
  await expect.poll(() => inlineStyle(panel, "width")).toMatch(/48px/);
  await expect.poll(() => inlineStyle(body, "gridTemplateColumns")).toBe("minmax(0px, 1fr)");
  await expect.poll(() => inlineStyle(rail, "position")).toBe("relative");
});

test("swaps between the selected empty-day rail and the event detail rail", async ({ page }) => {
  const fixture = await installDashboardCalendarLayoutFixtures(page);
  await page.setViewportSize({ width: 1900, height: 1200 });

  await openCalendar(page);

  await expect(page.getByTestId(`calendar-cell-${fixture.todayDay}`)).toBeVisible();
  await expect(page.getByTestId("calendar-selected-empty-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-selected-empty-rail").getByText("Open day")).toBeVisible();
  await expect(page.getByTestId("calendar-selected-empty-rail").getByText(/Nothing is scheduled here/i)).toBeVisible();

  await page.getByTestId(`calendar-cell-${fixture.eventDay}`).click();

  await expect(page.getByTestId("timeline-detail-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-selected-event-title")).toContainText(fixture.eventTitle);
  await expect(page.getByTestId("timeline-detail-row").first()).toContainText(fixture.eventTitle);

  await page.getByTestId(`calendar-cell-${fixture.todayDay}`).click();

  await expect(page.getByTestId("calendar-selected-empty-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-selected-empty-rail").getByText(/Nothing is scheduled here/i)).toBeVisible();
});
