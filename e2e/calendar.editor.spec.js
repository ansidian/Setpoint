import { expect, test } from "@playwright/test";
import {
  installDashboardCalendarCreateFixtures,
  installDashboardRecurringCalendarFixtures,
} from "./support/dashboard-fixtures.js";

async function openCalendar(page) {
  await page.goto("/");
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible();
}

test("creates a calendar event from the header action using deterministic fixtures", async ({ page }) => {
  const fixture = await installDashboardCalendarCreateFixtures(page);

  await openCalendar(page);

  await expect(page.getByTestId(`calendar-cell-${fixture.day}`)).toBeVisible();
  await expect(page.getByTestId("calendar-selected-empty-rail")).toBeVisible();

  await page.getByRole("button", { name: "New event" }).click();
  await expect(page.getByTestId("calendar-event-editor-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-event-save")).toBeDisabled();

  await page.getByTestId("calendar-event-title").fill(fixture.createdTitle);
  await expect(page.getByTestId("calendar-event-source")).toHaveValue("gmail-main::primary");
  await expect(page.getByTestId("calendar-event-save")).toBeEnabled();

  const createRequest = page.waitForRequest((request) =>
    request.method() === "POST"
      && request.url().includes("/api/calendar/events"),
  );

  await page.getByTestId("calendar-event-save").click();

  const createPayload = (await createRequest).postDataJSON();
  expect(createPayload).toMatchObject({
    title: fixture.createdTitle,
    accountId: "gmail-main",
    calendarId: "primary",
    startDate: fixture.ymd,
  });

  await expect(page.getByTestId("calendar-event-editor-rail")).toBeHidden();
  await expect(page.getByTestId("calendar-selected-event-title")).toContainText(fixture.createdTitle);
  await expect(page.getByTestId("timeline-detail-row").first()).toContainText(fixture.createdTitle);
});

test("requires a recurring scope before saving recurring event edits", async ({ page }) => {
  const fixture = await installDashboardRecurringCalendarFixtures(page);

  await openCalendar(page);

  await expect(page.getByTestId("calendar-selected-event-title")).toContainText(fixture.recurringTitle);

  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByTestId("calendar-event-editor-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-recurring-scope-prompt")).toBeVisible();
  await expect(page.getByTestId("calendar-event-save")).toBeDisabled();

  await page.getByTestId("calendar-recurring-scope-one").click();
  const editorRail = page.getByTestId("calendar-event-editor-rail");
  await expect(editorRail.getByTestId("calendar-event-save").last()).toBeEnabled();
  await expect(page.getByTestId("calendar-recurrence-section")).toHaveCount(0);

  await page.getByTestId("calendar-event-title").fill(fixture.updatedTitle);

  const updateRequest = page.waitForRequest((request) =>
    request.method() === "PATCH"
      && request.url().includes("/api/calendar/events/recurring-1"),
  );

  await editorRail.getByTestId("calendar-event-save").last().click();

  const updatePayload = (await updateRequest).postDataJSON();
  expect(updatePayload).toMatchObject({
    title: fixture.updatedTitle,
    scope: "one",
    recurringEventId: "series-1",
    originalStartTime: fixture.originalStartTime,
  });
  expect(updatePayload.recurrence).toBeUndefined();

  await expect(page.getByTestId("calendar-event-editor-rail")).toBeHidden();
  await expect(page.getByTestId("calendar-selected-event-title")).toContainText(fixture.updatedTitle);
  await expect(page.getByTestId("timeline-detail-row").first()).toContainText(fixture.updatedTitle);
});

test("deletes recurring events using the selected scope", async ({ page }) => {
  const fixture = await installDashboardRecurringCalendarFixtures(page);

  await openCalendar(page);

  await expect(page.getByTestId("calendar-selected-event-title")).toContainText(fixture.recurringTitle);

  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByTestId("calendar-event-editor-rail")).toBeVisible();

  await page.getByTestId("calendar-recurring-scope-following").click();
  const editorRail = page.getByTestId("calendar-event-editor-rail");
  await expect(editorRail.getByTestId("calendar-event-delete").last()).toBeEnabled();

  const deleteRequest = page.waitForRequest((request) =>
    request.method() === "DELETE"
      && request.url().includes("/api/calendar/events/recurring-1"),
  );

  await editorRail.getByTestId("calendar-event-delete").last().click();
  await editorRail.getByTestId("calendar-event-delete-confirm").last().click();

  const deletePayload = (await deleteRequest).postDataJSON();
  expect(deletePayload).toMatchObject({
    accountId: "gmail-main",
    calendarId: "primary",
    etag: '"recurring-etag-1"',
    scope: "following",
    recurringEventId: "series-1",
    originalStartTime: fixture.originalStartTime,
  });

  await expect(page.getByTestId("calendar-event-editor-rail")).toHaveCount(0);
  await expect(page.getByTestId("calendar-selected-empty-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-selected-event-title")).toHaveCount(0);
});
