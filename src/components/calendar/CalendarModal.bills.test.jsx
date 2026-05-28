import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./CalendarModal.test-setup.js";
import CalendarModal from "./CalendarModal.jsx";
import { wrapWithDashboard } from "./CalendarModal.test-utils.jsx";

describe("CalendarModal bills behavior", () => {
  it("shows the pending-update indicator for background Bills refreshes with visible data", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={{
          loading: true,
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
            recentTransactions: [],
            payeeMap: {},
          },
        }}
        deadlinesData={{}}
      />,
    ));

    const indicator = screen.getByTestId("calendar-pending-update");
    expect(indicator.textContent).toBe("");
    expect(indicator.getAttribute("aria-label")).toBe("Calendar updates pending");
    expect(indicator.querySelector(".calendar-pending-update-icon")).toBeTruthy();
  });

  it("hides the Bills pending-update indicator during initial no-data loading", () => {
    window.innerWidth = 1900;

    render(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={{ loading: true, data: null }}
        deadlinesData={{}}
      />,
    ));

    expect(screen.queryByTestId("calendar-pending-update")).toBeNull();
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

      const waterRow = screen.getByText("Water").parentElement?.parentElement;
      expect(waterRow).toBeTruthy();
      expect(within(waterRow).getByText("next May 26")).toBeTruthy();
    });

    it("treats a paid past-due utility as honored, not stale", () => {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="bills"
          onViewChange={() => {}}
          focusDate="2026-05-20"
          eventsData={{ getEvents: () => [] }}
          billsData={{
            schedules: [
              {
                id: "water:2026-05-10",
                scheduleId: "water",
                name: "Water Bill",
                payee: "SGV Water",
                next_date: "2026-05-10",
                amount: 50.67,
                paid: true,
                type: "bill",
              },
            ],
            payeeMap: {},
          }}
          deadlinesData={{}}
        />,
      ));

      const trigger = screen.getByLabelText("Utility statement status");
      fireEvent.click(trigger);

      const waterRow = screen.getByText("Water").parentElement?.parentElement;
      expect(within(waterRow).getByText("paid May 10")).toBeTruthy();
      const dateSpan = within(waterRow).getByText("paid May 10");
      const computed = dateSpan.getAttribute("style") || "";
      expect(computed).not.toContain("rgb(249, 115, 22)");
    });

    it("looks past the visible range when locating tracked utility schedules", () => {
      window.innerWidth = 1900;

      render(wrapWithDashboard(
        <CalendarModal
          open
          onClose={() => {}}
          view="bills"
          onViewChange={() => {}}
          focusDate="2026-05-20"
          eventsData={{ getEvents: () => [] }}
          billsData={{
            schedules: [
              {
                id: "spectrum:2026-05-25",
                scheduleId: "spectrum",
                name: "Spectrum",
                payee: "Spectrum",
                next_date: "2026-05-25",
                amount: 50,
                paid: false,
                type: "bill",
              },
              {
                id: "water:2026-06-26",
                scheduleId: "water",
                name: "Water Bill",
                payee: "SGV Water",
                next_date: "2026-06-26",
                amount: 50.67,
                paid: false,
                type: "bill",
              },
            ],
            payeeMap: {},
          }}
          billsRangeData={{
            data: {
              schedules: [
                {
                  id: "spectrum:2026-05-25",
                  scheduleId: "spectrum",
                  name: "Spectrum",
                  payee: "Spectrum",
                  next_date: "2026-05-25",
                  amount: 50,
                  paid: false,
                  type: "bill",
                },
              ],
              payeeMap: {},
            },
          }}
          deadlinesData={{}}
        />,
      ));

      fireEvent.click(screen.getByLabelText("Utility statement status"));

      const waterRow = screen.getByText("Water").parentElement?.parentElement;
      expect(within(waterRow).getByText("next Jun 26")).toBeTruthy();
    });
  });

  it("refetches the visible Bills range when range data is marked stale", async () => {
    window.innerWidth = 1900;
    const ensureRange = vi.fn().mockResolvedValue({});
    const renderModal = (revision) => wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="bills"
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        billsRangeData={{
          revision,
          ensureRange,
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
          },
        }}
        deadlinesData={{}}
      />,
    );

    const { rerender } = render(renderModal(0));
    await waitFor(() => expect(ensureRange).toHaveBeenCalledTimes(1));

    rerender(renderModal(1));
    await waitFor(() => expect(ensureRange).toHaveBeenCalledTimes(2));
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
        }}
        deadlinesData={{}}
      />,
    ));

    const agendaRail = screen.getByTestId("bills-agenda-rail");
    fireEvent.click(within(agendaRail).getByTestId("calendar-agenda-bill-row"));

    const panel = await screen.findByTestId("calendar-floating-detail-panel");
    expect(panel.getAttribute("data-floating-mode")).toBe("detail");
    expect(within(panel).getAllByText("Rent").length).toBeGreaterThan(0);
    expect(within(panel).getByText("$1,800.00")).toBeTruthy();
  });

  it("opens agenda-anchored floating bill detail from dashboard item focus", async () => {
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
    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-row");
    expect(within(panel).getAllByText("Rent").length).toBeGreaterThan(0);
    expect(within(panel).getByText("$1,800.00")).toBeTruthy();
  });

  it("opens agenda-anchored floating bill detail when dashboard focus uses schedule id and range uses instance id", async () => {
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
    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-row");
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
    expect(panel.getAttribute("data-anchor-kind")).toBe("agenda-row");
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

    const renderModal = (billsRangeData) => wrapWithDashboard(
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

  it("keeps Bills and Deadlines stacked layouts on the timeline detail rail", async () => {
    window.innerWidth = 1100;

    const { rerender } = render(wrapWithDashboard(
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
              conditions: [{ field: "amount", value: { num1: 180000 } }],
            },
          ],
        }}
        deadlinesData={{}}
      />,
    ));

    expect(await screen.findByTestId("timeline-detail-rail")).toBeTruthy();
    expect(screen.queryByTestId("bills-agenda-rail")).toBeNull();

    rerender(wrapWithDashboard(
      <CalendarModal
        open
        onClose={() => {}}
        view="events"
        forceDeadlineOverlay
        onViewChange={() => {}}
        focusDate="2026-04-20"
        eventsData={{ getEvents: () => [] }}
        billsData={{}}
        deadlinesData={{
          upcoming: [{ id: "deadline-1", title: "Project due", due_date: "2026-04-20", status: "open" }],
        }}
      />,
    ));

    expect(await screen.findByTestId("timeline-detail-rail")).toBeTruthy();
    expect(screen.queryByTestId("events-agenda-rail")).toBeNull();
  });
});
