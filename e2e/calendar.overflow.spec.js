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

function longDateLabel(year, month, day) {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
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

async function readStyle(locator) {
  return locator.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderTopColor: style.borderTopColor,
      boxShadow: style.boxShadow,
      color: style.color,
      opacity: style.opacity,
      transform: style.transform,
    };
  });
}

async function expectHoverStyleDifference(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  await page.mouse.move(4, 4);
  const before = await readStyle(locator);
  const tracksHoverState = await locator.evaluate((node) => node.hasAttribute("data-hovered"));

  await locator.hover();

  if (tracksHoverState) {
    await expect(locator).toHaveAttribute("data-hovered", "true");
  }

  await expect
    .poll(async () => {
      const after = await readStyle(locator);
      return Object.keys(before).some((key) => after[key] !== before[key]);
    }, {
      message: `${label} should expose at least one computed-style delta on hover`,
      timeout: 3000,
    })
    .toBe(true);
}

test("keeps overflow popover visible while switching between +n more triggers", async ({ page }) => {
  const fixture = buildOverflowFixture();
  await installDashboardShellFixtures(page, { initialEvents: fixture.events });
  await openCalendar(page);

  const firstTrigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.firstDay}`);
  const secondTrigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.secondDay}`);
  const popover = page.getByTestId("calendar-cell-overflow-popover");
  const firstHiddenTitle = eventTitle(fixture.firstPrefix, 4);
  const secondHiddenTitle = eventTitle(fixture.secondPrefix, 4);

  await expect(firstTrigger).toBeVisible();
  await expect(secondTrigger).toBeVisible();

  await firstTrigger.click();

  await expect(popover).toBeVisible();
  await expect(popover).toContainText(longDateLabel(fixture.year, fixture.month, fixture.firstDay));
  await expect(popover).toContainText(firstHiddenTitle);
  await expect(popover).toHaveCount(1);

  await secondTrigger.click();

  await expect(popover).toBeVisible();
  await expect(popover).toContainText(longDateLabel(fixture.year, fixture.month, fixture.secondDay));
  await expect(popover).toContainText(secondHiddenTitle);
  await expect(popover).not.toContainText(firstHiddenTitle);
  await expect(popover).toHaveCount(1);
});

test("closes overflow popover when clicking same +n more trigger again", async ({ page }) => {
  const fixture = buildOverflowFixture();
  await installDashboardShellFixtures(page, { initialEvents: fixture.events });
  await openCalendar(page);

  const trigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.firstDay}`);
  const popover = page.getByTestId("calendar-cell-overflow-popover");

  await expect(trigger).toBeVisible();

  await trigger.click();
  await expect(popover).toBeVisible();

  await trigger.click();
  await expect(popover).toHaveCount(0);
});

test("shows hover style deltas for visible event chips", async ({ page }) => {
  const fixture = buildOverflowFixture();
  await installDashboardShellFixtures(page, { initialEvents: fixture.events });
  await openCalendar(page);

  const firstCell = page.getByTestId(`calendar-cell-${fixture.firstDay}`);
  const visibleChip = firstCell.getByTestId("calendar-cell-item-chip").first();
  const overflowTrigger = firstCell.getByTestId(`calendar-cell-overflow-trigger-${fixture.firstDay}`);

  await expect(visibleChip).toBeVisible();
  await expect(overflowTrigger).toBeVisible();

  const chipBox = await visibleChip.boundingBox();
  const triggerBox = await overflowTrigger.boundingBox();
  expect(chipBox?.height ?? 0).toBeGreaterThanOrEqual(29);
  expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(27);

  await expectHoverStyleDifference(page, visibleChip, "event chip");
});

test("keeps four visible chips when selecting a dense desktop day from the cell header", async ({ page }) => {
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

  await expect(cell.getByTestId("calendar-cell-item-chip")).toHaveCount(4);
  await expect(cell.getByTestId(`calendar-cell-overflow-trigger-${day}`)).toContainText("+2 more");

  await cell.click({
    position: {
      x: 18,
      y: 18,
    },
  });

  await expect(supportBand).toHaveAttribute("data-support-mode", "detail");
  await expect(page.getByTestId("calendar-selected-event-card")).toHaveCount(0);
  await expect(cell.getByTestId("calendar-cell-item-chip")).toHaveCount(4);
  await expect(cell.getByTestId(`calendar-cell-overflow-trigger-${day}`)).toContainText("+2 more");
});

test("shows hover style deltas for overflow rows", async ({ page }) => {
  const fixture = buildOverflowFixture();
  await installDashboardShellFixtures(page, { initialEvents: fixture.events });
  await openCalendar(page);

  const overflowTrigger = page.getByTestId(`calendar-cell-overflow-trigger-${fixture.firstDay}`);
  const popover = page.getByTestId("calendar-cell-overflow-popover");

  await overflowTrigger.click();
  await expect(popover).toBeVisible();

  const overflowRow = popover.getByTestId("calendar-cell-overflow-item").first();
  await expect(overflowRow).toBeVisible();
  await expectHoverStyleDifference(page, overflowRow, "overflow row");
});
