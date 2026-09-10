import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import KeepAliveTab from "./KeepAliveTab";
import CompletionTransition from "./CompletionTransition";

afterEach(cleanup);

function Harness() {
  const [active, setActive] = useState(true);
  const [visible, setVisible] = useState(true);
  const [completed, setCompleted] = useState<string[]>([]);
  return <>
    <button onClick={() => setActive(value => !value)}>Switch tab</button>
    <button onClick={() => { setVisible(false); setCompleted(["item"]); }}>Complete item</button>
    <button onClick={() => setVisible(false)}>Handle email</button>
    <button onClick={() => setCompleted([])}>Refresh</button>
    <KeepAliveTab active={active}>
      <AnimatePresence initial={false} custom={completed}>
        {visible && <CompletionTransition key="item" itemId="item"><button>Urgent item</button></CompletionTransition>}
      </AnimatePresence>
    </KeepAliveTab>
  </>;
}

// An interrupted exit must release its inert DOM; browser timing alone cannot
// reliably exercise Activity's effect cleanup during a hidden data refresh.
it("removes a handled email when its tab resumes with changed data", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Switch tab"));
  fireEvent.click(screen.getByText("Handle email"));
  fireEvent.click(screen.getByText("Switch tab"));
  await waitFor(() => expect(screen.queryByText("Urgent item")).toBeNull());
});

it("keeps a completion receipt when refresh prunes the completed id mid-exit", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Complete item"));
  expect(screen.queryByText("Done")).not.toBeNull();
  fireEvent.click(screen.getByText("Refresh"));
  expect(screen.queryByText("Done")).not.toBeNull();
  await waitFor(() => expect(screen.queryByText("Urgent item")).toBeNull());
});

it("finishes the in-place receipt before re-enabling a row after a fast refresh", async () => {
  const view = render(<CompletionTransition itemId="task" completing><button>Calendar task</button></CompletionTransition>);
  view.rerender(<CompletionTransition itemId="task"><button>Calendar task</button></CompletionTransition>);
  expect(screen.queryByText("Done")).not.toBeNull();
  expect(screen.getByText("Calendar task").closest("[inert]")).not.toBeNull();
  await waitFor(() => expect(screen.queryByText("Done")).toBeNull());
  expect(screen.getByText("Calendar task").closest("[inert]")).toBeNull();
});
