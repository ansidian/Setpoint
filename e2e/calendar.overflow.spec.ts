import { expect, test, type Page } from "@playwright/test";
import { installDashboardShellFixtures } from "./support/dashboard-fixtures.ts";

test.describe.configure({ timeout: 60_000 });

interface MonthParts {
  year: number;
  month: number;
  today: number;
  daysInMonth: number;
}

interface DayEventsOptions {
  year: number;
  month: number;
  day: number;
  prefix: string;
  color: string;
  count?: number;
}

function currentMonthParts(): MonthParts {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth(),
    today: now.getDate(),
    daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
  };
}

function pickOverflowDays({ today, daysInMonth }: MonthParts): [number, number] {
  const maxStart = Math.max(2, daysInMonth - 1);
  const primary = Math.min(Math.max(today + 1, 2), maxStart);
  const secondary = primary === maxStart ? primary - 1 : primary + 1;
  return [Math.min(primary, secondary), Math.max(primary, secondary)];
}

function eventMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

function eventTitle(prefix: string, index: number): string {
  return `${prefix} ${index}`;
}

function buildDayEvents({ year, month, day, prefix, color, count = 6 }: DayEventsOptions) {
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

async function openCalendar(page: Page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByTestId("shell-header-desktop")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByTestId("calendar-modal-panel")).toBeVisible({ timeout: 15_000 });
}

test("keeps one inline overflow visible while switching between +n more triggers", async ({ page }) => {
  const fixture = buildOverflowFixture();
  await installDashboardShellFixtures(page, { initialEvents: fixture.events });
  await openCalendar(page);

  const firstTrigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.firstDay}`);
  const secondTrigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.secondDay}`);
  const inlineOverflow = page.getByTestId("calendar-cell-inline-overflow");
  const firstHiddenTitle = eventTitle(fixture.firstPrefix, 4);
  const secondHiddenTitle = eventTitle(fixture.secondPrefix, 4);

  await expect(firstTrigger).toBeVisible();
  await expect(secondTrigger).toBeVisible();

  await firstTrigger.click();

  await expect(inlineOverflow).toBeVisible();
  await expect(inlineOverflow).toContainText(firstHiddenTitle);
  await expect(inlineOverflow).toHaveCount(1);
  await expect(page.getByTestId("calendar-cell-overflow-popover")).toHaveCount(0);

  await secondTrigger.click();

  await expect(inlineOverflow).toBeVisible();
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
