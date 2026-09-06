import { expect, test, type Page } from "@playwright/test";
import { installDashboardInboxFixtures } from "./support/dashboard-fixtures.ts";

async function openInbox(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByTestId("inbox-mobile-list")).toBeVisible();
}

test("preserves mobile inbox search when opening and closing a reader", async ({ page }) => {
  const { actionSubject } = await installDashboardInboxFixtures(page);

  await openInbox(page);

  await page.getByRole("button", { name: "Search mail", exact: true }).click();
  await page.getByLabel("Search indexed mail").fill("Project");
  await page.getByTestId("inbox-mobile-list").getByText(actionSubject, { exact: true }).click();

  await expect(page.getByTestId("inbox-mobile-reader")).toBeVisible();
  await expect(page.getByTestId("inbox-mobile-reader-body")).toBeVisible();

  await page.getByLabel("Back to inbox").click();
  await expect(page.getByTestId("inbox-mobile-list")).toBeVisible();
  await expect(page.getByLabel("Search indexed mail")).toHaveValue("Project");
});

test("filters the mobile inbox and opens reader action workspaces", async ({ page }) => {
  const { actionSubject, personalSubject, liveSubject } = await installDashboardInboxFixtures(page);

  await openInbox(page);

  await page.getByTestId("inbox-mobile-filter-trigger").click();
  await expect(page.getByTestId("inbox-mobile-filter-sheet")).toBeVisible();

  const filterSheet = page.getByTestId("inbox-mobile-filter-sheet");
  await filterSheet.getByRole("button", { name: /Work/i }).click();

  await expect(page.getByTestId("inbox-mobile-filter-sheet")).toHaveCount(0);
  const list = page.getByTestId("inbox-mobile-list");
  await expect(list.getByText(actionSubject, { exact: true })).toBeVisible();
  await expect(list.getByText(personalSubject, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Open filters", exact: true }).click();
  await filterSheet.getByRole("button", { name: "Needs attention", exact: true }).click();
  await expect(list.getByText(actionSubject, { exact: true })).toBeVisible();
  await expect(list.getByText(liveSubject, { exact: true })).toBeVisible();
  await expect(list.getByText(personalSubject, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Open filters", exact: true }).click();
  await filterSheet.getByRole("button", { name: "All mail", exact: true }).click();

  await page.getByTestId("inbox-mobile-list").getByText(actionSubject, { exact: true }).click();
  const reader = page.getByTestId("inbox-mobile-reader");
  await expect(reader).toBeVisible();

  await reader.getByRole("button", { name: "More email actions", exact: true }).click();
  await page.getByRole("button", { name: "Actual record", exact: true }).click();
  await expect(page.getByTestId("inbox-mobile-bill-panel")).toBeVisible();

  await reader.getByRole("button", { name: "More email actions", exact: true }).click();
  await page.getByRole("button", { name: /Show draft reply/i }).click();
  await expect(page.getByTestId("inbox-mobile-draft-panel")).toBeVisible();
});

test("returns from the mobile reader to the inbox list on browser back", async ({ page }) => {
  const { actionSubject } = await installDashboardInboxFixtures(page);

  await openInbox(page);
  await page.getByTestId("inbox-mobile-list").getByText(actionSubject, { exact: true }).click();

  await expect(page.getByTestId("inbox-mobile-reader")).toBeVisible();
  await page.goBack();

  await expect(page.getByTestId("inbox-mobile-list")).toBeVisible();
  await expect(page.getByTestId("inbox-mobile-reader")).toHaveCount(0);
});
