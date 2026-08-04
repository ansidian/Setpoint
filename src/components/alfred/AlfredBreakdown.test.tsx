import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AlfredBreakdown from "./AlfredBreakdown";

afterEach(cleanup);

const email = (uid: string, subject: string) => ({ uid, id: uid, subject, from: { name: "Acme" }, email_date: "2026-05-18T12:00:00Z" });

// Server-ordered (count desc): Ghosted(6) before Rejected(2).
const buckets = [
  { label: "Ghosted", count: 6, items: Array.from({ length: 6 }, (_, i) => email(`g${i}`, `ghost-${i}`)) },
  { label: "Rejected", count: 2, items: [email("r0", "rej-0"), email("r1", "rej-1")] },
];

function renderCard(props = {}) {
  return render(
    <AlfredBreakdown
      kind="email" title="By status" caption="last 3 months" total={8}
      buckets={buckets} accent="#94e2d5" onActivateItem={() => {}} {...props}
    />,
  );
}

function InteractiveCard() {
  const [selected, setSelected] = useState("none");
  return <>
    <AlfredBreakdown kind="email" title="By status" caption="last 3 months" total={8}
      buckets={buckets} accent="#94e2d5" onActivateItem={(action) => setSelected(action.type === "email" ? String(action.item.uid) : action.type)} />
    <output>{selected}</output>
  </>;
}

describe("AlfredBreakdown", () => {
  it("renders the header, labels, counts, and total", () => {
    renderCard();
    expect(screen.getByText("By status")).toBeTruthy();
    expect(screen.getByText(/last 3 months · 8 total/)).toBeTruthy();
    expect(screen.getByText("Ghosted")).toBeTruthy();
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("renders a small bucket (<= 5) open by default", () => {
    renderCard();
    expect(screen.getByText("rej-0")).toBeTruthy();
    expect(screen.getByText("rej-1")).toBeTruthy();
  });

  it("renders a large bucket (> 5) collapsed until its header is clicked", () => {
    renderCard();
    expect(screen.queryByText("ghost-0")).toBeNull();
    fireEvent.click(screen.getByText("Ghosted"));
    expect(screen.getByText("ghost-0")).toBeTruthy();
  });

  it("invokes onActivateItem with the resolved action when a chip is clicked", () => {
    render(<InteractiveCard />);
    fireEvent.click(screen.getByText("rej-0"));
    expect(screen.getByText("r0")).toBeTruthy();
  });

  it("renders nothing (returns null) when there are no buckets", () => {
    const { container } = render(
      <AlfredBreakdown kind="email" title="x" caption="" total={0} buckets={[]} accent="#94e2d5" onActivateItem={() => {}} />,
    );
    expect(container.textContent).toBe("");
    expect(container.firstChild).toBeNull();
  });

  it("keeps duplicate-label buckets independent (no key-collision state bleed)", () => {
    const dup = [
      { label: "Archived", count: 6, items: Array.from({ length: 6 }, (_, i) => email(`a${i}`, `arch-a-${i}`)) },
      { label: "Archived", count: 2, items: [email("b0", "arch-b-0"), email("b1", "arch-b-1")] },
    ];
    render(
      <AlfredBreakdown kind="email" title="By status" caption="" total={8} buckets={dup} accent="#94e2d5" onActivateItem={() => {}} />,
    );
    // First "Archived" (6) starts collapsed; second (2) starts open. A bare-label
    // key would collide and share open-state, breaking one of these.
    expect(screen.queryByText("arch-a-0")).toBeNull();
    expect(screen.getByText("arch-b-0")).toBeTruthy();
  });

  it("renders a drill-down row for every supported kind (guards the row-component map)", () => {
    const cases = [
      { kind: "email", item: { uid: "x", id: "x", subject: "an email", from: { name: "A" }, email_date: "2026-05-01T00:00:00Z" }, text: "an email" },
      { kind: "bill", item: { id: "b", name: "a bill", payee: "P", amount: 10, next_date: "2026-06-01", paid: false }, text: "a bill" },
      { kind: "event", item: { id: "ev", title: "an event", time: "9:00 AM", calendarName: "Cal" }, text: "an event" },
      { kind: "deadline", item: { id: "d", content: "a deadline", due_date: "2026-06-01", status: "incomplete" }, text: "a deadline" },
      { kind: "transaction", item: { id: "t", payee: "a payee", category: "C", amount: 5, date: "2026-06-01" }, text: "a payee" },
    ] as const;
    for (const c of cases) {
      const { unmount } = render(
        <AlfredBreakdown
          kind={c.kind} title="By kind" caption="" total={1}
          buckets={[{ label: "Bucket", count: 1, items: [c.item] }]} accent="#94e2d5" onActivateItem={() => {}}
        />,
      );
      expect(screen.getByText(c.text)).toBeTruthy();
      unmount();
    }
  });
});
