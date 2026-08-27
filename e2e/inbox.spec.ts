import { expect, test } from "@playwright/test";
import { installDashboardInboxFixtures } from "./support/dashboard-fixtures.ts";

test("dismisses the lane glossary when navigating away from the inbox", async ({ page }) => {
  await installDashboardInboxFixtures(page);

  await page.goto("/");
  await page.getByRole("tab", { name: /Inbox/ }).click();

  await page.getByRole("button", { name: "About inbox lanes" }).hover();
  await expect(page.getByText("Special lanes", { exact: true })).toBeVisible();

  await page.keyboard.press("1");

  await expect(page.getByText("Special lanes", { exact: true })).toHaveCount(0);

  await page.keyboard.press("2");
  await expect(page.getByText("Special lanes", { exact: true })).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "About inbox lanes" }).hover();
  await expect(page.getByText("Special lanes", { exact: true })).toBeVisible();
});
