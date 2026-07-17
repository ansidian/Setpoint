import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DeadlineSelectedActions from "./DeadlineDetailActions.tsx";

afterEach(cleanup);

const task = { id: "t1", status: "open", url: "https://todoist.com/showTask?id=1" };

describe("DeadlineSelectedActions hideEdit", () => {
  it("shows Edit by default (desktop)", () => {
    render(<DeadlineSelectedActions task={task} onEdit={() => {}} onComplete={() => {}} />);
    expect(screen.getByText("Mark complete")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Open in Todoist")).toBeTruthy();
  });

  it("hides Edit when hideEdit (mobile), keeping Complete + Open", () => {
    render(<DeadlineSelectedActions task={task} onEdit={() => {}} onComplete={() => {}} hideEdit />);
    expect(screen.getByText("Mark complete")).toBeTruthy();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.getByText("Open in Todoist")).toBeTruthy();
  });
});
