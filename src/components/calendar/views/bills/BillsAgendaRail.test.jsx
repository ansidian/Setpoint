import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BillsAgendaRail from "./BillsAgendaRail.jsx";
import { compute } from "./billsModel.js";

afterEach(() => {
  cleanup();
});

function renderRail(props = {}) {
  const data = {
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
      {...props}
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
});
