import { expect, test } from "@playwright/test";
import { installDashboardShellFixtures } from "./support/dashboard-fixtures.js";

test("uses the mobile shell, hides calendar entry points, and returns from inbox on browser back", async ({ page }) => {
  await installDashboardShellFixtures(page);

  await page.goto("/");

  await expect(page.getByTestId("shell-header-mobile")).toBeVisible();
  await expect(page.getByTestId("dashboard-body-mobile")).toBeVisible();
  await expect(page.getByTestId("shell-header-desktop")).toHaveCount(0);

  await page.getByLabel("Open more actions").click();
  const historyItem = page.getByRole("button", { name: "Briefing history" });
  const overflowMenu = historyItem.locator("xpath=..");
  await expect(historyItem).toBeVisible();
  await expect(overflowMenu.getByText("Calendar", { exact: true })).toHaveCount(0);
  await page.getByLabel("Open more actions").click();

  await page.keyboard.press("c");
  await expect(page.getByTestId("calendar-modal-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page.getByTestId("inbox-mobile-list")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("dashboard-body-mobile")).toBeVisible();
  await expect(page.getByTestId("inbox-mobile-list")).toHaveCount(0);
});
