import { expect, test } from "@playwright/test";
import { installDashboardCalendarLayoutFixtures } from "./support/dashboard-fixtures.js";

test.describe.configure({ timeout: 60_000 });

async function openCalendar(page) {
  await page.goto("/");
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("c");
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible({ timeout: 15_000 });
}

async function resizeViewport(page, size) {
  await page.setViewportSize(size);
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(size.width);
}

test("keeps the workspace rail usable across desktop and compact widths", async ({ page }) => {
  await installDashboardCalendarLayoutFixtures(page);
  await page.setViewportSize({ width: 1900, height: 1200 });

  await openCalendar(page);

  const panel = page.getByTestId("calendar-modal-panel");
  const body = page.getByTestId("calendar-modal-body");
  const rail = page.getByTestId("calendar-modal-rail");
  const supportBand = page.getByTestId("calendar-modal-support-band");
  const monthGrid = page.getByTestId("calendar-grid-month");

  await expect(panel).toBeVisible();
  await expect(body).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(monthGrid).toBeVisible();
  await expect(supportBand).toHaveAttribute("data-support-mode", "empty");

  await resizeViewport(page, { width: 1240, height: 1000 });

  await expect(panel).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(monthGrid).toBeVisible();
  await expect(supportBand).toHaveAttribute("data-support-mode", "empty");

  await resizeViewport(page, { width: 1100, height: 1000 });

  await expect(panel).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(monthGrid).toBeVisible();
  await expect(supportBand).toHaveAttribute("data-support-mode", "empty");
});

test("navigates the calendar month from vertical wheel input on the grid", async ({ page }) => {
  await installDashboardCalendarLayoutFixtures(page);
  await page.setViewportSize({ width: 1900, height: 1200 });

  await openCalendar(page);

  const now = new Date();
  const nextMonthLabel = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });

  await expect(page.getByTestId("calendar-month-title")).toContainText(
    new Date(now.getFullYear(), now.getMonth(), 1)
      .toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  );

  await page.getByTestId("calendar-grid-shell").hover();
  await page.mouse.wheel(0, 220);

  await expect(page.getByTestId("calendar-month-title")).toContainText(nextMonthLabel);
});

test("keeps selected-event context in the rail while the support band stays day-focused", async ({ page }) => {
  const fixture = await installDashboardCalendarLayoutFixtures(page);
  await page.setViewportSize({ width: 1900, height: 1200 });

  await openCalendar(page);

  const supportBand = page.getByTestId("calendar-modal-support-band");
  const rail = page.getByTestId("calendar-modal-rail");

  await expect(page.getByTestId(`calendar-cell-${fixture.todayDay}`)).toBeVisible();
  await expect(page.getByTestId("calendar-selected-empty-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-selected-empty-rail").getByText("Open day")).toBeVisible();
  await expect(page.getByTestId("calendar-selected-empty-rail").getByText(/Nothing is scheduled here/i)).toBeVisible();
  await expect(supportBand).toHaveAttribute("data-support-mode", "empty");
  await expect(rail).toHaveAttribute("data-context-mode", "empty");

  await page.getByTestId(`calendar-cell-${fixture.eventDay}`).click();

  await expect(supportBand).toHaveAttribute("data-support-mode", "detail");
  await expect(rail).toHaveAttribute("data-context-mode", "detail");
  await expect(page.getByTestId("timeline-detail-rail")).toBeVisible();
  await expect(page.getByTestId("timeline-detail-row").first()).toContainText(fixture.eventTitle);
  await expect(page.getByTestId("calendar-selected-event-card")).toHaveCount(0);

  await page.getByTestId(`calendar-cell-${fixture.eventDay}`).getByTestId("calendar-cell-item-chip").click();

  await expect(rail.getByTestId("calendar-selected-event-card")).toBeVisible();
  await expect(rail.getByTestId("calendar-selected-event-title")).toContainText(fixture.eventTitle);
  await expect(supportBand.getByTestId("calendar-selected-event-card")).toHaveCount(0);

  await page.getByTestId(`calendar-cell-${fixture.todayDay}`).click();

  await expect(supportBand).toHaveAttribute("data-support-mode", "empty");
  await expect(rail).toHaveAttribute("data-context-mode", "empty");
  await expect(page.getByTestId("calendar-selected-empty-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-selected-empty-rail").getByText(/Nothing is scheduled here/i)).toBeVisible();
});

test("keeps selected-deadline context in the rail while the support band stays day-focused", async ({ page }) => {
  const fixture = await installDashboardCalendarLayoutFixtures(page);
  await page.setViewportSize({ width: 1900, height: 1200 });

  await openCalendar(page);

  const supportBand = page.getByTestId("calendar-modal-support-band");
  const rail = page.getByTestId("calendar-modal-rail");

  await page.getByRole("button", { name: /deadlines/i }).click();
  await expect(page.getByTestId(`calendar-cell-${fixture.deadlineDay}`)).toBeVisible();
  await expect(supportBand).toHaveAttribute("data-support-mode", "empty");
  await expect(rail).toHaveAttribute("data-context-mode", "empty");

  await page.getByTestId(`calendar-cell-${fixture.deadlineDay}`).click();

  await expect(supportBand).toHaveAttribute("data-support-mode", "detail");
  await expect(rail).toHaveAttribute("data-context-mode", "detail");
  await expect(page.getByTestId("timeline-detail-rail")).toBeVisible();
  await expect(page.getByTestId("timeline-detail-row").first()).toContainText(fixture.deadlineTitle);
  await expect(page.getByTestId("calendar-selected-deadline-card")).toHaveCount(0);

  await page.getByTestId(`calendar-cell-${fixture.deadlineDay}`).getByTestId("calendar-cell-item-chip").click();

  await expect(rail.getByTestId("calendar-selected-deadline-card")).toBeVisible();
  await expect(rail.getByTestId("calendar-selected-deadline-title")).toContainText(fixture.deadlineTitle);
  await expect(supportBand.getByTestId("calendar-selected-deadline-card")).toHaveCount(0);
});

test("widens the context stage and keeps the grid visible when entering editor mode", async ({ page }) => {
  const fixture = await installDashboardCalendarLayoutFixtures(page);
  await page.setViewportSize({ width: 1900, height: 1200 });

  await openCalendar(page);

  const supportBand = page.getByTestId("calendar-modal-support-band");
  const rail = page.getByTestId("calendar-modal-rail");

  await page.getByTestId(`calendar-cell-${fixture.eventDay}`).click();
  await page.getByTestId(`calendar-cell-${fixture.eventDay}`).getByTestId("calendar-cell-item-chip").click();
  await expect(page.getByTestId("calendar-selected-event-title")).toContainText(fixture.eventTitle);

  await page.getByRole("button", { name: "Edit details" }).click();

  await expect(page.getByTestId("calendar-event-editor-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-event-editor-rail")).toHaveAttribute("data-editor-layout", "desktop-staged");
  await expect(page.getByTestId("calendar-event-editor-detail-layout")).toHaveAttribute("data-layout-mode", "desktop-staged");
  await expect(page.getByTestId("calendar-modal-editor-expanded")).toBeVisible();
  await expect(supportBand).toHaveAttribute("data-support-mode", "editor");
  await expect(rail).toHaveAttribute("data-context-mode", "editor");
  await expect(supportBand).not.toContainText(/draft rhythm/i);
  await expect(supportBand).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  await expect(supportBand).not.toContainText(/choose a calendar/i);
  await expect(supportBand).not.toContainText(/ready for details/i);
  await expect(page.getByTestId(`calendar-cell-${fixture.eventDay}`)).toBeVisible();
});
