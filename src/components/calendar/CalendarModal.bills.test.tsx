import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.ts";
import CalendarModal from "./CalendarModal.tsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.tsx";

describe("CalendarModal bills behavior", () => {
  it("infinite-scrolls Bills: renders a bill from a month beyond the active one when the range exposes per-month data", async () => {
    window.innerWidth = 1900;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000-07:00"));
    try {
      const buckets: Record<string, { schedules: Array<Record<string, unknown>>; payeeMap: Record<string, unknown> }> = {
        "2026-06": {
          schedules: [
            { id: "june-1", scheduleId: "june-1", name: "June Only Bill", next_date: "2026-06-15", amount: 50, paid: false, type: "bill" },
          ],
          payeeMap: {},
        },
      };
      const getMonthData = (year: number, month: number) => buckets[`${year}-${String(month + 1).padStart(2, "0")}`] || { schedules: [], payeeMap: {} };

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="bills"
          onViewChange={() => {}}
          focusDate="2026-05-01"
          eventsData={{ getEvents: () => [] }}
          billsData={{}}
          billsRangeData={{
            loading: false,
            revision: 1,
            data: { schedules: [], payeeMap: {} },
            ensureRange: vi.fn().mockResolvedValue(undefined),
            getMonthData,
          }}
          deadlinesData={{}}
        />,
      ));

      // June is one month after the active May view; the full controller → adapter
      // → rail multi-month chain must fetch + render it without navigating there.
      expect(await screen.findByText("June Only Bill")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("utility statement status", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date("2026-05-20T12:00:00.000-07:00"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("matches utility statement status against mirrored bill payees", () => {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="bills"
          onViewChange={() => {}}
          focusDate="2026-05-26"
          eventsData={{ getEvents: () => [] }}
          billsData={{
            schedules: [
              {
                id: "water:2026-05-26",
                scheduleId: "water",
                name: "Water Bill",
                payee: "SGV Water",
                next_date: "2026-05-26",
                amount: 50.67,
                paid: false,
                type: "bill",
              },
            ],
            payeeMap: {},
          }}
          deadlinesData={{}}
        />,
      ));

      fireEvent.click(screen.getByLabelText("Utility statement status"));

      // Behavioral guard: opening the control surfaces the tracked-utility
      // popover with the matched Water row. The status/date-text derivation
      // itself is covered by utilityStatusModel.test.ts.
      expect(screen.getByText("Water")).toBeTruthy();
      expect(screen.getByText("next May 26")).toBeTruthy();
    });
  });

  it("opens floating bill detail from a bills agenda row", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{
          schedules: [
            {
              id: "bill-1",
              name: "Rent",
              next_date: "2026-04-20",
              paid: false,
              type: "bill",
              conditions: [
                { field: "amount", value: { num1: 180000 } },
                { field: "payee", value: "payee-1" },
              ],
            },
          ],
          payeeMap: { "payee-1": "Landlord" },
          actualBudgetUrl: "https://actual.example",
          payLinksByScheduleId: { "bill-1": "https://pay.example/rent" },
        }}
        deadlinesData={{}}
      />,
    ));

    const agendaRail = screen.getByTestId("bills-agenda-rail");
    fireEvent.click(within(agendaRail).getByTestId("calendar-agenda-bill-row"));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(within(panel).getAllByText("Rent").length).toBeGreaterThan(0);
    expect(within(panel).getByText("Scheduled bill")).toBeTruthy();
    expect(within(panel).getByText("$1,800.00")).toBeTruthy();
    const actualLink = within(panel).getByRole("link", { name: "Open in Actual" });
    expect(actualLink.getAttribute("href")).toBe("https://actual.example/schedules?highlight=bill-1");
    expect(actualLink.getAttribute("target")).toBe("_blank");
    expect(actualLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(panel).getByRole("link", { name: "Pay Online" }).getAttribute("href"))
      .toBe("https://pay.example/rent");
  });

  it("opens chip-anchored floating bill detail from dashboard item focus", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="bill-1"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{
          schedules: [
            {
              id: "bill-1",
              name: "Rent",
              next_date: "2026-04-20",
              paid: false,
              type: "bill",
              conditions: [
                { field: "amount", value: { num1: 180000 } },
                { field: "payee", value: "payee-1" },
              ],
            },
          ],
          payeeMap: { "payee-1": "Landlord" },
        }}
        deadlinesData={{}}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(panel.getAttribute("data-anchor-kind")).toBe("chip");
    expect(within(panel).getAllByText("Rent").length).toBeGreaterThan(0);
    expect(within(panel).getByText("$1,800.00")).toBeTruthy();
  });

  it("opens chip-anchored floating bill detail when dashboard focus uses schedule id and range uses instance id", async () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="bill-1"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={{
          data: {
            schedules: [
              {
                id: "bill-1:2026-04-20",
                scheduleId: "bill-1",
                name: "Rent",
                next_date: "2026-04-20",
                amount: 1800,
                paid: false,
                type: "bill",
              },
            ],
            payeeMap: {},
          },
          loading: false,
          ensureRange: async () => {},
        }}
        deadlinesData={{}}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(panel.getAttribute("data-anchor-kind")).toBe("chip");
    expect(within(panel).getAllByText("Rent").length).toBeGreaterThan(0);
    expect(within(panel).getByText("$1,800.00")).toBeTruthy();
  });

  it("keeps floating bill detail open when bills data swaps from schedule id to range instance id", async () => {
    window.innerWidth = 1900;

    const { rerender } = render(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="bill-1"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{
          schedules: [
            {
              id: "bill-1",
              name: "Rent",
              next_date: "2026-04-20",
              paid: false,
              type: "bill",
              conditions: [
                { field: "amount", value: { num1: 180000 } },
                { field: "payee", value: "payee-1" },
              ],
            },
          ],
          payeeMap: { "payee-1": "Landlord" },
        }}
        deadlinesData={{}}
      />,
    ));

    const initialPanel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(within(initialPanel).getByText("$1,800.00")).toBeTruthy();

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        focusItemId="bill-1"
        focusOpenDetail
        eventsData={{ getEvents: () => [] }}
        billsData={{
          schedules: [
            {
              id: "bill-1",
              name: "Rent",
              next_date: "2026-04-20",
              paid: false,
              type: "bill",
              conditions: [
                { field: "amount", value: { num1: 180000 } },
                { field: "payee", value: "payee-1" },
              ],
            },
          ],
          payeeMap: { "payee-1": "Landlord" },
        }}
        billsRangeData={{
          data: {
            schedules: [
              {
                id: "bill-1:2026-04-20",
                scheduleId: "bill-1",
                name: "Rent",
                next_date: "2026-04-20",
                amount: 1800,
                paid: false,
                type: "bill",
              },
            ],
            payeeMap: {},
          },
          loading: false,
          ensureRange: async () => {},
        }}
        deadlinesData={{}}
      />,
    ));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(panel.getAttribute("data-anchor-kind")).toBe("chip");
    expect(within(panel).getAllByText("Rent").length).toBeGreaterThan(0);
    expect(within(panel).getByText("$1,800.00")).toBeTruthy();
  });

  it("moves the selected floating bill detail when a mirror refresh changes the occurrence date", async () => {
    window.innerWidth = 1900;

    const initialBillsRange = {
      data: {
        schedules: [
          {
            id: "bill-1:2026-04-20",
            scheduleId: "bill-1",
            name: "Rent",
            next_date: "2026-04-20",
            amount: 1800,
            paid: false,
            type: "bill",
          },
        ],
        payeeMap: {},
      },
      loading: false,
      ensureRange: async () => {},
    };
    const movedBillsRange = {
      data: {
        schedules: [
          {
            id: "bill-1:2026-04-22",
            scheduleId: "bill-1",
            name: "Rent",
            next_date: "2026-04-22",
            amount: 1900,
            paid: false,
            type: "bill",
          },
        ],
        payeeMap: {},
      },
      loading: false,
      ensureRange: async () => {},
    };

    const renderModal = (billsRangeData: Record<string, unknown>) => wrapWithDashboard(
      <CalendarModal
        open
        openRequestId={1}
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={billsRangeData}
        deadlinesData={{}}
      />,
    );

    const { rerender } = render(renderModal(initialBillsRange));
    const initialCell = await screen.findByTestId("calendar-cell-20");
    fireEvent.click(within(initialCell).getByTestId("calendar-cell-item-chip"));

    const initialPanel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(initialPanel.getAttribute("data-anchor-kind")).toBe("chip");
    expect(within(initialPanel).getByText("$1,800.00")).toBeTruthy();

    rerender(renderModal(movedBillsRange));

    await waitFor(() => {
      const movedCell = screen.getByTestId("calendar-cell-22");
      const movedChip = within(movedCell).getByTestId("calendar-cell-item-chip");
      expect(movedChip.getAttribute("data-item-id")).toBe("bill-1");
      const movedPanel = screen.getByTestId("calendar-floating-detail-panel");
      expect(movedPanel.getAttribute("data-anchor-kind")).toBe("chip");
      expect(within(movedPanel).getByText("$1,900.00")).toBeTruthy();
    });
  });

});
