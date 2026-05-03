import { expect, test } from "@playwright/test";
import { installDashboardCalendarLayoutFixtures } from "./support/dashboard-fixtures.js";

test.describe.configure({ timeout: 60_000 });

async function openCalendar(page) {
  await page.goto("/");
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("c");
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible({ timeout: 15_000 });
}

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
