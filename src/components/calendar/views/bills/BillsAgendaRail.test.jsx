import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BillsAgendaRail from "./BillsAgendaRail.jsx";
import { compute } from "./billsModel.js";

afterEach(() => {
  cleanup();
});

function renderRail(props = {}) {
  const data = props.data || {
    schedules: [
      {
        id: "bill-1",
        name: "Internet",
        payee: "Spectrum",
        amount: 84.5,
        next_date: "2026-05-05",
        type: "bill",
      },
    ],
  };

  return render(
    <BillsAgendaRail
      viewYear={2026}
      viewMonth={4}
      currentYear={2026}
      currentMonth={4}
      todayDate={1}
      selectedDateKey="2026-05-05"
      computed={compute({ data, viewYear: 2026, viewMonth: 4 })}
      {...Object.fromEntries(Object.entries(props).filter(([key]) => key !== "data"))}
    />,
  );
}

describe("BillsAgendaRail", () => {
  it("renders today's header and empty target when today has no bills", () => {
    renderRail({
      todayDate: 2,
      selectedDateKey: "2026-05-05",
    });

    expect(screen.getByRole("button", { name: /select saturday, may 2/i })).toBeTruthy();
    expect(screen.getByText("TODAY 5/2/26")).toBeTruthy();
    expect(screen.getByText("No Bills")).toBeTruthy();
  });

  it("renders an enriched empty-month state in the mobile agenda", () => {
    const { container } = renderRail({
      data: { schedules: [] },
      currentMonth: 3,
      selectedDateKey: null,
      mobileAgenda: true,
    });

    const primary = screen.getByText("No bills due in May");
    const secondary = screen.getByText("Days you add will appear here.");
    const card = primary.parentElement;
    expect(card.style.padding).toBe("28px 16px");
    expect(card.style.alignItems).toBe("center");
    expect(card.style.textAlign).toBe("center");
    expect(secondary.style.color).toBe("var(--color-text-faint)");
    expect(container.querySelector("svg.lucide-receipt")).toBeTruthy();
    expect(screen.queryByText("No Bills This Month")).toBeNull();
  });

  it("keeps mobile per-day empty cards compact", () => {
    renderRail({
      currentMonth: 3,
      selectedDateKey: "2026-05-02",
      mobileAgenda: true,
    });

    const label = screen.getByText("No Bills");
    expect(label.parentElement.style.padding).toBe("12px 10px");
    expect(screen.queryByText(/No bills due in/)).toBeNull();
  });

  it("keeps the desktop-default empty-month card unchanged", () => {
    renderRail({
      data: { schedules: [] },
      currentMonth: 3,
      selectedDateKey: null,
    });

    const label = screen.getByText("No Bills This Month");
    const card = label.parentElement;
    expect(card.style.padding).toBe("12px 10px");
    expect(card.style.display).toBe("");
    expect(card.style.textAlign).toBe("");
    expect(screen.queryByText(/No bills due in/)).toBeNull();
    expect(screen.queryByText("Days you add will appear here.")).toBeNull();
  });

  it("keeps Mini Calendar markers scoped to Bills and previews focused bill rows", () => {
    renderRail({
      data: {
        schedules: [
          {
            id: "bill-1",
            name: "Internet",
            payee: "Spectrum",
            amount: 84.5,
            next_date: "2026-05-05",
            type: "transfer",
          },
        ],
      },
    });

    const calendar = screen.getByTestId("calendar-mini-calendar");
    const mayFive = within(calendar).getByRole("button", { name: /Tuesday, May 5, selected/i });
    const markers = within(mayFive).getAllByTestId("calendar-mini-calendar-marker");
    expect(markers.map((marker) => marker.getAttribute("data-marker-kind"))).toEqual(["dot"]);
    expect(markers[0].getAttribute("data-marker-color")).toBe("#89b4fa");

    fireEvent.focus(screen.getByTestId("calendar-agenda-bill-row"));

    expect(screen.getByTestId("calendar-agenda-bill-row").classList.contains("sp-agenda-touch")).toBe(true);
    expect(mayFive.getAttribute("data-hover-preview")).toBe("active");
    expect(mayFive.getAttribute("data-hover-preview-color")).toBe("#89b4fa");
  });

  it("renders signed transaction rows and transaction mini-calendar markers", () => {
    const onBillAction = vi.fn();
    renderRail({
      data: {
        schedules: [],
        transactions: [
          { id: "income-1", date: "2026-05-05", payee: "Employer", category: "Income", account: "Checking", amount: 5000, direction: "income" },
        ],
      },
      onBillAction,
    });

    const row = screen.getByTestId("calendar-agenda-transaction-row");
    expect(row.getAttribute("data-item-kind")).toBe("transaction");
    expect(within(row).getByText("Employer")).toBeTruthy();
    expect(within(row).getByText("+$5,000.00")).toBeTruthy();
    expect(within(row).getByText("Inflow")).toBeTruthy();
    fireEvent.click(row);
    expect(onBillAction).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({ id: "income-1" }),
      detailKind: "transaction",
    }));

    const mayFive = within(screen.getByTestId("calendar-mini-calendar"))
      .getByRole("button", { name: /Tuesday, May 5, selected/i });
    const marker = within(mayFive).getByTestId("calendar-mini-calendar-marker");
    expect(marker.getAttribute("data-marker-source-kind")).toBe("transaction");
    expect(marker.getAttribute("data-marker-color")).toBe("#89dceb");
  });

  it("shows bill markers for trailing Mini Calendar dates while viewing the current month", () => {
    renderRail({
      selectedDateKey: "2026-05-05",
      data: {
        schedules: [
          {
            id: "bill-1",
            name: "Internet",
            payee: "Spectrum",
            amount: 84.5,
            next_date: "2026-06-01",
            type: "transfer",
          },
        ],
      },
    });

    const juneOne = within(screen.getByTestId("calendar-mini-calendar"))
      .getByRole("button", { name: /Monday, June 1/i });
    expect(juneOne.getAttribute("data-adjacent-position")).toBe("trailing");

    const markers = within(juneOne).getAllByTestId("calendar-mini-calendar-marker");
    expect(markers.map((marker) => marker.getAttribute("data-marker-kind"))).toEqual(["dot"]);
    expect(markers[0].getAttribute("data-marker-color")).toBe("#89b4fa");
  });

  it("renders bills from months beyond the active month once a range provider is wired (infinite scroll)", async () => {
    const buckets = {
      "2026-06": { schedules: [{ id: "june-1", name: "June Only Bill", amount: 50, next_date: "2026-06-15", type: "bill" }] },
    };
    const getMonthBills = (year, month) => buckets[`${year}-${String(month + 1).padStart(2, "0")}`] || { schedules: [] };
    const billsRange = { ensureRange: vi.fn().mockResolvedValue(undefined), loading: false, revision: 1 };

    renderRail({ getMonthBills, billsRange });

    // June is a month after the active May view; with the multi-month pipeline on,
    // its bill is fetched + rendered without navigating there. (Gate off — no range
    // — keeps the single-month behavior the other tests assert.)
    expect(await screen.findByText("June Only Bill")).toBeTruthy();
    expect(billsRange.ensureRange).toHaveBeenCalled();
  });
});
