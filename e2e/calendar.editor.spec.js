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

async function clickButtonInPage(page, label) {
  await page.evaluate((buttonLabel) => {
    const button = [...document.querySelectorAll("button")]
      .find((node) => (node.textContent || "").includes(buttonLabel));
    if (!button) throw new Error(`Button not found: ${buttonLabel}`);
    button.click();
  }, label);
}

async function recordEditorRailEntrance(page, buttonLabel) {
  await page.evaluate(() => {
    window.__calendarRailEntranceSamples = [];
    window.__calendarRailEntranceStop = false;
    window.__calendarRailEntranceStart = performance.now();

    const sample = () => {
      const target = document.querySelector("[data-testid='calendar-event-editor-rail']")
        || document.querySelector("[data-testid='todoist-inline-editor']");
      const wrapper = document.querySelector("[data-testid='calendar-rail-content']")?.parentElement;

      if (target) {
        const rect = target.getBoundingClientRect();
        const transform = wrapper ? getComputedStyle(wrapper).transform : "none";
        const translateX = transform && transform !== "none"
          ? new DOMMatrixReadOnly(transform).m41
          : 0;

        window.__calendarRailEntranceSamples.push({
          t: performance.now() - window.__calendarRailEntranceStart,
          x: rect.x,
          translateX,
        });
      }

      if (!window.__calendarRailEntranceStop) requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });

  await clickButtonInPage(page, buttonLabel);
  await page.waitForTimeout(520);

  const samples = await page.evaluate(() => {
    window.__calendarRailEntranceStop = true;
    return window.__calendarRailEntranceSamples;
  });

  expect(samples.length).toBeGreaterThan(10);

  const firstTime = samples[0].t;
  const finalX = samples[samples.length - 1].x;
  return samples.map((sample) => ({
    elapsed: sample.t - firstTime,
    x: sample.x,
    remaining: sample.x - finalX,
    translateX: sample.translateX,
  }));
}

function sampleRailAt(samples, elapsedMs) {
  return samples.reduce((closest, sample) => (
    Math.abs(sample.elapsed - elapsedMs) < Math.abs(closest.elapsed - elapsedMs) ? sample : closest
  ), samples[0]);
}

function expectRailProjectionFrame(samples, elapsedMs) {
  const frame = sampleRailAt(samples, elapsedMs);
  expect(frame.translateX).toBeGreaterThan(64);
  expect(frame.remaining).toBeGreaterThan(64);
  expect(Math.abs(frame.remaining - frame.translateX)).toBeLessThan(70);
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
  await page.getByTestId("calendar-cell-item-chip").filter({ hasText: fixture.createdTitle }).first().click();
  await expect(page.getByTestId("calendar-selected-event-title")).toContainText(fixture.createdTitle);
  await expect(page.getByTestId("timeline-detail-row").first()).toContainText(fixture.createdTitle);
});

test("opens a fresh event editor from the dashboard Add Event action every time", async ({ page }) => {
  await installDashboardCalendarCreateFixtures(page);

  await page.goto("/");
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible();

  await page.getByRole("button", { name: "Add Event" }).click();
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible();
  await expect(page.getByTestId("calendar-event-editor-rail")).toBeVisible();
  await page.getByTestId("calendar-event-title").fill("Temporary draft");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("calendar-event-editor-rail")).toBeHidden();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("calendar-modal-panel")).toBeHidden();

  await page.getByRole("button", { name: "Add Event" }).click();
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible();
  await expect(page.getByTestId("calendar-event-editor-rail")).toBeVisible();
  await expect(page.getByTestId("calendar-event-title")).toHaveValue("");
});

test("opens event create from g+c after dismissing a g+t Todoist create request", async ({ page }) => {
  await installDashboardCalendarCreateFixtures(page);

  await page.goto("/");
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible();

  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible();
  await expect(page.getByTestId("todoist-inline-editor")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("todoist-inline-editor")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("calendar-modal-panel")).toBeHidden();

  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible();
  await expect(page.getByTestId("calendar-event-editor-rail")).toBeVisible();
});

test("matches the Todoist inline editor rail entrance to the event editor", async ({ page }) => {
  await installDashboardCalendarCreateFixtures(page);
  await page.setViewportSize({ width: 1440, height: 960 });

  await openCalendar(page);
  await expect(page.getByTestId("calendar-selected-empty-rail")).toBeVisible();

  const eventSamples = await recordEditorRailEntrance(page, "New event");
  await expect(page.getByTestId("calendar-event-editor-rail")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("calendar-event-editor-rail")).toBeHidden();

  await page.getByRole("button", { name: "Deadlines" }).click();
  await expect(page.getByRole("button", { name: /new todoist/i })).toBeVisible();
  await page.waitForTimeout(360);

  const taskSamples = await recordEditorRailEntrance(page, "New Todoist");
  await expect(page.getByTestId("todoist-inline-editor")).toBeVisible();

  expectRailProjectionFrame(eventSamples, 100);
  expectRailProjectionFrame(taskSamples, 100);
});

test("requires a recurring scope before saving recurring event edits", async ({ page }) => {
  const fixture = await installDashboardRecurringCalendarFixtures(page);

  await openCalendar(page);

  await page.getByTestId("calendar-cell-item-chip").filter({ hasText: fixture.recurringTitle }).first().click();
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

  await page.getByTestId("calendar-cell-item-chip").filter({ hasText: fixture.recurringTitle }).first().click();
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
