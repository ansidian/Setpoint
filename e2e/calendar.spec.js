import { expect, test } from "@playwright/test";
import { installDashboardCalendarFixtures } from "./support/dashboard-fixtures.js";

test("edits a calendar event from the detail rail using deterministic fixtures", async ({ page }) => {
  const fixture = await installDashboardCalendarFixtures(page);

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible();

  await page.keyboard.press("c");

  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible();
  await expect(page.getByTestId(`calendar-cell-${fixture.day}`)).toBeVisible();
  await expect(page.getByTestId("timeline-detail-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-selected-event-title")).toContainText(fixture.initialTitle);
  await expect(page.getByTestId("timeline-detail-row").first()).toContainText(fixture.initialTitle);

  await page.getByRole("button", { name: "Edit details" }).click();

  await expect(page.getByTestId("calendar-event-editor-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-event-title")).toHaveValue(fixture.initialTitle);
  await page.getByTestId("calendar-event-title").fill(fixture.updatedTitle);
  await page.getByTestId("calendar-event-save").click();

  await expect(page.getByTestId("calendar-event-editor-rail")).toBeHidden();
  await expect(page.getByTestId("calendar-selected-event-title")).toContainText(fixture.updatedTitle);
  await expect(page.getByTestId("timeline-detail-row").first()).toContainText(fixture.updatedTitle);
});
