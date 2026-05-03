import { expect, test } from "@playwright/test";
import { installDashboardShellFixtures } from "./support/dashboard-fixtures.js";

test.describe.configure({ timeout: 60_000 });

function currentMonthParts() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth(),
    today: now.getDate(),
    daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
  };
}

function pickOverflowDays({ today, daysInMonth }) {
  const maxStart = Math.max(2, daysInMonth - 1);
  const primary = Math.min(Math.max(today + 1, 2), maxStart);
  const secondary = primary === maxStart ? primary - 1 : primary + 1;
  return [Math.min(primary, secondary), Math.max(primary, secondary)];
}

function eventMs(year, month, day, hour, minute = 0) {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

function eventTitle(prefix, index) {
  return `${prefix} ${index}`;
}

function buildDayEvents({ year, month, day, prefix, color, count = 6 }) {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    const startHour = 9 + index;
    return {
      id: `${prefix.toLowerCase().replace(/\s+/g, "-")}-${ordinal}`,
      etag: `"${prefix.toLowerCase().replace(/\s+/g, "-")}-etag-${ordinal}"`,
      title: eventTitle(prefix, ordinal),
      accountId: "gmail-main",
      calendarId: "primary",
      startMs: eventMs(year, month, day, startHour),
      endMs: eventMs(year, month, day, startHour, 30),
      writable: true,
      isRecurring: false,
      allDay: false,
      htmlLink: "https://calendar.google.com/calendar/u/0/r",
      location: `${prefix} room ${ordinal}`,
      color,
    };
  });
}

function buildOverflowFixture() {
  const parts = currentMonthParts();
  const [firstDay, secondDay] = pickOverflowDays(parts);
  const firstPrefix = "Alpha overflow";
  const secondPrefix = "Beta overflow";

  return {
    ...parts,
    firstDay,
    secondDay,
    firstPrefix,
    secondPrefix,
    events: [
      ...buildDayEvents({
        year: parts.year,
        month: parts.month,
        day: firstDay,
        prefix: firstPrefix,
        color: "#4285f4",
      }),
      ...buildDayEvents({
        year: parts.year,
        month: parts.month,
        day: secondDay,
        prefix: secondPrefix,
        color: "#f59e0b",
      }),
    ],
  };
}

async function openCalendar(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("c");
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible({ timeout: 15_000 });
}

async function openCalendarAtSize(page, size) {
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("c");
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible({ timeout: 15_000 });
}

test("keeps one inline overflow visible while switching between +n more triggers", async ({ page }) => {
  const fixture = buildOverflowFixture();
  await installDashboardShellFixtures(page, { initialEvents: fixture.events });
  await openCalendar(page);

  const firstCell = page.getByTestId(`calendar-cell-${fixture.firstDay}`);
  const secondCell = page.getByTestId(`calendar-cell-${fixture.secondDay}`);
  const firstTrigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.firstDay}`);
  const secondTrigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.secondDay}`);
  const inlineOverflow = page.getByTestId("calendar-cell-inline-overflow");
  const firstHiddenTitle = eventTitle(fixture.firstPrefix, 4);
  const secondHiddenTitle = eventTitle(fixture.secondPrefix, 4);

  await expect(firstTrigger).toBeVisible();
  await expect(secondTrigger).toBeVisible();

  await firstTrigger.click();

  await expect(firstCell.getByTestId("calendar-cell-inline-overflow")).toBeVisible();
  await expect(inlineOverflow).toContainText(firstHiddenTitle);
  await expect(inlineOverflow).toHaveCount(1);
  await expect(page.getByTestId("calendar-cell-overflow-popover")).toHaveCount(0);

  await secondTrigger.click();

  await expect(secondCell.getByTestId("calendar-cell-inline-overflow")).toBeVisible();
  await expect(inlineOverflow).toContainText(secondHiddenTitle);
  await expect(inlineOverflow).not.toContainText(firstHiddenTitle);
  await expect(inlineOverflow).toHaveCount(1);
});

test("closes inline overflow on Escape before closing the modal", async ({ page }) => {
  const fixture = buildOverflowFixture();
  await installDashboardShellFixtures(page, { initialEvents: fixture.events });
  await openCalendar(page);

  const trigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.firstDay}`);
  const inlineOverflow = page.getByTestId("calendar-cell-inline-overflow");

  await expect(trigger).toBeVisible();

  await trigger.click();
  await expect(inlineOverflow).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(inlineOverflow).toHaveCount(0);
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible();
});

test("shows visible event chips with an overflow trigger", async ({ page }) => {
  const fixture = buildOverflowFixture();
  await installDashboardShellFixtures(page, { initialEvents: fixture.events });
  await openCalendar(page);

  const firstCell = page.getByTestId(`calendar-cell-${fixture.firstDay}`);
  const visibleChip = firstCell.getByTestId("calendar-cell-item-chip").first();
  const overflowTrigger = firstCell.getByTestId(`calendar-cell-overflow-trigger-${fixture.firstDay}`);

  await expect(visibleChip).toBeVisible();
  await expect(overflowTrigger).toBeVisible();
});

test("keeps the xl dense-day chip count stable when selecting from the cell header", async ({ page }) => {
  const parts = currentMonthParts();
  const [day] = pickOverflowDays(parts);
  const events = buildDayEvents({
    year: parts.year,
    month: parts.month,
    day,
    prefix: "Dense day",
    color: "#4285f4",
    count: 6,
  });

  await installDashboardShellFixtures(page, { initialEvents: events });
  await openCalendarAtSize(page, { width: 1900, height: 1200 });

  const cell = page.getByTestId(`calendar-cell-${day}`);
  const supportBand = page.getByTestId("calendar-modal-support-band");

  await expect(cell.getByTestId("calendar-cell-item-chip")).toHaveCount(3);
  await expect(cell.getByTestId(`calendar-cell-overflow-trigger-${day}`)).toContainText("+3 more");

  await cell.click({
    position: {
      x: 18,
      y: 18,
    },
  });

  await expect(supportBand).toHaveAttribute("data-support-mode", "detail");
  await expect(page.getByTestId("calendar-selected-event-card")).toHaveCount(0);
  await expect(cell.getByTestId("calendar-cell-item-chip")).toHaveCount(3);
  await expect(cell.getByTestId(`calendar-cell-overflow-trigger-${day}`)).toContainText("+3 more");
});

test("keeps inline overflow open when selecting a hidden chip", async ({ page }) => {
  const fixture = buildOverflowFixture();
  await installDashboardShellFixtures(page, { initialEvents: fixture.events });
  await openCalendar(page);

  const firstCell = page.getByTestId(`calendar-cell-${fixture.firstDay}`);
  const overflowTrigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.firstDay}`);
  const inlineOverflow = firstCell.getByTestId("calendar-cell-inline-overflow");
  const hiddenTitle = eventTitle(fixture.firstPrefix, 4);

  await overflowTrigger.click();
  await expect(inlineOverflow).toBeVisible();

  const hiddenChip = inlineOverflow.getByText(hiddenTitle);
  await hiddenChip.click();

  await expect(inlineOverflow).toBeVisible();
  await expect(firstCell.getByTestId("calendar-cell-item-chip").filter({ hasText: hiddenTitle })).toBeVisible();
});
