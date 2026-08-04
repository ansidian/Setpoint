import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RowsBlock } from "./AlfredRows";
import type { AlfredItemKind } from "../../../shared/types/alfred";

afterEach(cleanup);

describe("RowsBlock", () => {
  function InteractiveRows({ kind = "bill" as AlfredItemKind }) {
    const [actions, setActions] = useState<string[]>([]);
    const items = kind === "email"
      ? [{ uid: "m1", subject: "Verify enrollment", from: { name: "Financial Aid" }, email_date: "2026-06-12T17:30:00.000Z" }]
      : [{ id: "b1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false }];
    return <>
      <RowsBlock accent="#cba6da" kind={kind} items={items} onActivateItem={(action) => setActions((current) => [...current, action.type === "email" ? String(action.item.uid) : `${action.type}:${action.request.focusItemId}`])} />
      <output>{actions.join(",") || "none"}</output>
    </>;
  }
  it("renders bill rows with tabular amount, due date, and paid chip", () => {
    render(<RowsBlock accent="#cba6da" kind="bill" items={[
      { id: "b1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false },
      { id: "b2", name: "Spotify", payee: "Spotify", amount: 12.99, next_date: "2026-06-14", paid: true },
    ]} />);
    expect(screen.getByText("Rent")).toBeTruthy();
    // $1,850.00 appears on the row and again in the Total due footer (only unpaid bill).
    expect(screen.getAllByText("$1,850.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Jun 14")).toBeTruthy();
    // the paid chip now keeps the date visible: "Paid · Jun 14"
    expect(screen.getByText(/^Paid ·/)).toBeTruthy();
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
    const { container } = render(<RowsBlock accent="#cba6da" kind={"unknown_kind" as AlfredItemKind} items={[{ id: "x" }]} />);
    expect(container.textContent).toBe("");
  });

  it("renders a transaction row with payee, amount, and category", () => {
    render(
      <RowsBlock
        kind="transaction"
        items={[{ id: "t1", date: "2026-05-05", amount: 42.1, payee: "Trader Joes", category: "Groceries", account: "Checking" }]}
        accent="#cba6f7"
        now={new Date("2026-06-14T12:00:00-07:00")}
      />,
    );
    expect(screen.getByText("Trader Joes")).toBeTruthy();
    expect(screen.getByText("$42.10")).toBeTruthy();
    expect(screen.getByText("Groceries")).toBeTruthy();
  });

  it("activates a chip on click and Enter with the resolved action", () => {
    render(<InteractiveRows />);
    const chip = screen.getByRole("button");
    fireEvent.click(chip);
    fireEvent.keyDown(chip, { key: "Enter" });
    expect(screen.getByText("calendar:b1,calendar:b1")).toBeTruthy();
  });

  it("emits an email action for email chips", () => {
    render(<InteractiveRows kind="email" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("m1")).toBeTruthy();
  });

  it("renders rows non-interactive without an onActivateItem handler", () => {
    render(<RowsBlock accent="#cba6da" kind="bill" items={[
      { id: "b1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-14", paid: false },
    ]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a chip non-interactive when no action resolves", () => {
    render(<RowsBlock accent="#cba6da" kind="email" onActivateItem={() => {}} items={[
      { subject: "No uid", from: { name: "X" }, email_date: "2026-06-12T17:30:00.000Z" },
    ]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows an absolute-date tooltip on email rows", () => {
    render(<RowsBlock accent="#cba6da" kind="email" items={[
      { uid: "m1", subject: "Verify enrollment", from: { name: "Aid" }, email_date: "2026-06-12T17:30:00.000Z" },
    ]} />);
    expect(screen.getByTitle(/Received .*2026/)).toBeTruthy();
  });

  it("groups email rows into time sections when they span buckets", () => {
    const now = new Date("2026-06-13T18:00:00.000Z");
    render(<RowsBlock accent="#cba6da" kind="email" now={now} items={[
      { uid: "fresh", subject: "Fresh one", from: { name: "A" }, email_date: "2026-06-13T10:00:00.000Z" },
      { uid: "stale", subject: "Stale one", from: { name: "B" }, email_date: "2026-05-01T10:00:00.000Z" },
    ]} />);
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Earlier")).toBeTruthy();
  });

  it("omits section headers when all email rows fall in one bucket", () => {
    const now = new Date("2026-06-13T18:00:00.000Z");
    render(<RowsBlock accent="#cba6da" kind="email" now={now} items={[
      { uid: "a", subject: "One", from: { name: "A" }, email_date: "2026-05-01T10:00:00.000Z" },
      { uid: "b", subject: "Two", from: { name: "B" }, email_date: "2026-05-02T10:00:00.000Z" },
    ]} />);
    expect(screen.queryByText("Earlier")).toBeNull();
    expect(screen.queryByText("Today")).toBeNull();
  });

  it("groups events by day and surfaces the location", () => {
    const now = new Date("2026-06-14T18:00:00.000Z");
    render(<RowsBlock accent="#cba6da" kind="event" now={now} items={[
      { id: "e1", title: "Dentist", time: "10:00 AM", allDay: false, calendarName: "Personal", startMs: Date.parse("2026-06-14T17:00:00.000Z"), location: "Downtown Dental" },
      { id: "e2", title: "Standup", time: "9:00 AM", allDay: false, calendarName: "Work", startMs: Date.parse("2026-06-15T16:00:00.000Z") },
    ]} />);
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    expect(screen.getByText("Downtown Dental")).toBeTruthy();
  });

  it("routes a completed deadline into a Done section", () => {
    const now = new Date("2026-06-14T18:00:00.000Z");
    render(<RowsBlock accent="#cba6da" kind="deadline" now={now} items={[
      { id: "d1", title: "Submit timesheet", due_date: "2026-06-14", status: "incomplete" },
      { id: "d2", title: "File expense report", due_date: "2026-06-09", status: "complete" },
    ]} />);
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("shows a Total due footer summing only unpaid bills", () => {
    render(<RowsBlock accent="#cba6da" kind="bill" items={[
      { id: "b1", name: "Rent", payee: "Oakwood", amount: 1850, next_date: "2026-06-18", paid: false },
      { id: "b2", name: "Internet", payee: "Sonic", amount: 70, next_date: "2026-06-14", paid: false },
      { id: "b3", name: "Spotify", payee: "Spotify", amount: 12.99, next_date: "2026-06-05", paid: true },
    ]} />);
    expect(screen.getByText("Total due")).toBeTruthy();
    expect(screen.getByText("$1,920.00")).toBeTruthy();
  });
});
