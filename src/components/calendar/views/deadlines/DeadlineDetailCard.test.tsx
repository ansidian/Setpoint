import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HTMLAttributes, ReactNode } from "react";
import DeadlineDetailCard from "./DeadlineDetailCard.tsx";

vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, layout: _layout, transition: _transition, ...props }: HTMLAttributes<HTMLDivElement> & {
      children?: ReactNode;
      layout?: unknown;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
  },
  useReducedMotion: () => false,
}));

afterEach(() => {
  cleanup();
});

describe("DeadlineDetailCard", () => {
  it("shows Todoist priority in the compressed floating-detail layout", () => {
    render(
      <DeadlineDetailCard
        task={{
          id: "todo-priority",
          title: "Submit draft",
          source: "todoist",
          project_name: "School",
          due_date: "2026-05-12",
          due_time: "10:00 AM",
          priority: 1,
          status: "incomplete",
        }}
        accent="#e8776a"
        compact
        ultraCompact
      />,
    );

    expect(screen.getByText("P1 · Urgent")).toBeTruthy();
  });
});
