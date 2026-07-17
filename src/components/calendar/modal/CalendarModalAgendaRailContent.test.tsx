import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const railSpies = vi.hoisted(() => ({
  events: vi.fn(),
  bills: vi.fn(),
}));

vi.mock("../views/events/EventsAgendaRail.tsx", () => ({
  default: (props: Record<string, unknown>) => {
    railSpies.events(props);
    return <div data-testid="events-rail" />;
  },
}));

vi.mock("../views/bills/BillsAgendaRail.tsx", () => ({
  default: (props: Record<string, unknown>) => {
    railSpies.bills(props);
    return <div data-testid="bills-rail" />;
  },
}));

import CalendarModalAgendaRailContent from "./CalendarModalAgendaRailContent";

afterEach(() => {
  cleanup();
  railSpies.events.mockClear();
  railSpies.bills.mockClear();
});

describe("CalendarModalAgendaRailContent", () => {
  it("defaults the desktop rail contract to a non-mobile agenda", () => {
    render(<CalendarModalAgendaRailContent view="events" />);

    expect(railSpies.events).toHaveBeenCalledWith(expect.objectContaining({ mobileAgenda: false }));
  });

  it("forwards the mobile agenda flag to the events rail", () => {
    render(<CalendarModalAgendaRailContent view="events" mobileAgenda />);

    expect(railSpies.events).toHaveBeenCalledWith(expect.objectContaining({ mobileAgenda: true }));
  });

  it("forwards the mobile agenda flag to the bills rail", () => {
    render(<CalendarModalAgendaRailContent view="bills" mobileAgenda />);

    expect(railSpies.bills).toHaveBeenCalledWith(expect.objectContaining({ mobileAgenda: true }));
  });
});
