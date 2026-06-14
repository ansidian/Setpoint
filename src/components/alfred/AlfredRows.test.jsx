import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RowsBlock } from "./AlfredRows.jsx";

afterEach(cleanup);

describe("RowsBlock", () => {
  it("renders bill rows with tabular amount, due date, and paid chip", () => {
    render(<RowsBlock accent="#cba6da" kind="bill" items={[
      { id: "b1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false },
      { id: "b2", name: "Spotify", payee: "Spotify", amount: 12.99, next_date: "2026-06-14", paid: true },
    ]} />);
    expect(screen.getByText("Rent")).toBeTruthy();
    expect(screen.getByText("$1,850.00")).toBeTruthy();
    expect(screen.getByText("Jun 14")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
  });

  it("renders event rows with time column and calendar name", () => {
    render(<RowsBlock accent="#cba6da" kind="event" items={[
      { id: "e1", title: "Dentist", time: "2:00 PM", duration: "45m", allDay: false, calendarName: "Personal", dayLabel: "Fri, Jun 12" },
      { id: "e2", title: "Conference", time: "", allDay: true, calendarName: "Work", dayLabel: "Sat, Jun 13" },
    ]} />);
    expect(screen.getByText("2:00 PM")).toBeTruthy();
    expect(screen.getByText("Dentist")).toBeTruthy();
    expect(screen.getByText("all day")).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
  });

  it("renders deadline rows with priority flag and due date", () => {
    render(<RowsBlock accent="#cba6da" kind="deadline" items={[
      { id: "d1", content: "Renew registration", due_date: "2026-06-15", priority: 4, completed: false },
    ]} />);
    expect(screen.getByText("Renew registration")).toBeTruthy();
    expect(screen.getByText("P1")).toBeTruthy();
    expect(screen.getByText("Jun 15")).toBeTruthy();
  });

  it("renders email rows with sender and lane dot", () => {
    render(<RowsBlock accent="#cba6da" kind="email" items={[
      { uid: "m1", subject: "Verify enrollment", from: { name: "Financial Aid", address: "aid@school.edu" }, email_date: "2026-06-12T17:30:00.000Z", metadata: { lane: "needs_attention" } },
    ]} />);
    expect(screen.getByText("Verify enrollment")).toBeTruthy();
    expect(screen.getByText(/Financial Aid/)).toBeTruthy();
  });

  it("renders nothing for an unknown kind", () => {
    const { container } = render(<RowsBlock accent="#cba6da" kind="transaction" items={[{ id: "x" }]} />);
    expect(container.textContent).toBe("");
  });
});
