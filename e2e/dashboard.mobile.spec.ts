import { expect, test } from "@playwright/test";
import { installDashboardShellFixtures } from "./support/dashboard-fixtures.ts";

test("returns from the mobile inbox on browser back", async ({ page }) => {
  await installDashboardShellFixtures(page);

  await page.goto("/");

  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page.getByTestId("inbox-mobile-list")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("dashboard-body-mobile")).toBeVisible();
  await expect(page.getByTestId("inbox-mobile-list")).toBeHidden();
});
