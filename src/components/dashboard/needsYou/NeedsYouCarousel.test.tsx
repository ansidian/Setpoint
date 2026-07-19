import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NeedsYouCarousel } from "./NeedsYouCarousel";
import type { ReactNode } from "react";
import type { NeedsYouCard } from "./needsYouModel";

afterEach(() => { cleanup(); vi.useRealTimers(); });

vi.mock("../../shared/StatusChip", () => ({
  StatusChip: ({ label }: { label: string }) => <span data-testid="chip">{label}</span>,
}));

vi.mock("../../shared/StatusDot", () => ({
  StatusDot: () => <span data-testid="dot" />,
}));

vi.mock("../../shared/Tooltip", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="tooltip">{children}</div>,
}));

// Minimal card fixtures matching the shape produced by needsYouModel
const createUrgentCard = (id: string | number, title = "Test card"): NeedsYouCard => ({
  id: `deadline:${id}`,
  kind: "urgent",
  source: "Deadline",
  sourceIcon: "AlertCircle",
  tone: "var(--sp-rose)",
  email: false,
  opened: false,
  handleable: false,
  completable: true,
  snapshotItemId: null,
  uid: null,
  jumpKind: "deadline",
  jumpId: id,
  date: "2026-06-19",
  data: { id, title, due_date: "2026-06-19" },
  chipTooltip: "Due today",
  title,
  meta: "Work",
  pill: { label: "Due today", tone: "var(--sp-rose)" },
});

describe("NeedsYouCarousel", () => {
  it("renders the carousel with test ID", () => {
    render(
      <NeedsYouCarousel
        urgentCards={[createUrgentCard(1)]}
        backfillCards={[]}
        moreCount={0}
        moreLabel=""
        onShowAll={() => {}}
        onOpen={() => {}}
        onMarkHandled={() => {}}
        onComplete={() => {}}
        onJump={() => {}}
      />,
    );
    expect(screen.getByTestId("needs-you-carousel")).toBeTruthy();
  });

  it("sets touch-action to 'pan-x pan-y' to allow vertical page scroll to start on the carousel", () => {
    render(
      <NeedsYouCarousel
        urgentCards={[createUrgentCard(1), createUrgentCard(2)]}
        backfillCards={[]}
        moreCount={0}
        moreLabel=""
        onShowAll={() => {}}
        onOpen={() => {}}
        onMarkHandled={() => {}}
        onComplete={() => {}}
        onJump={() => {}}
      />,
    );
    const carousel = screen.getByTestId("needs-you-carousel");
    // This exact touch-action value is a gesture compatibility contract: both
    // horizontal carousel movement and vertical page scrolling must remain native.
    expect(carousel.style.touchAction).toBe("pan-x pan-y");
  });

  it("renders both urgent cards in the carousel", () => {
    render(
      <NeedsYouCarousel
        urgentCards={[
          createUrgentCard(1, "First card"),
          createUrgentCard(2, "Second card"),
        ]}
        backfillCards={[]}
        moreCount={0}
        moreLabel=""
        onShowAll={() => {}}
        onOpen={() => {}}
        onMarkHandled={() => {}}
        onComplete={() => {}}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("First card")).toBeTruthy();
    expect(screen.getByText("Second card")).toBeTruthy();
  });

  it("announces the current slide position via a polite live region", () => {
    render(
      <NeedsYouCarousel
        urgentCards={[
          createUrgentCard(1, "First card"),
          createUrgentCard(2, "Second card"),
          createUrgentCard(3, "Third card"),
        ]}
        backfillCards={[]}
        moreCount={0}
        moreLabel=""
        onShowAll={() => {}}
        onOpen={() => {}}
        onMarkHandled={() => {}}
        onComplete={() => {}}
        onJump={() => {}}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Card 1 of 3");
  });

  it("keeps the position dots hidden from assistive tech", () => {
    const { container } = render(
      <NeedsYouCarousel
        urgentCards={[createUrgentCard(1), createUrgentCard(2)]}
        backfillCards={[]}
        moreCount={0}
        moreLabel=""
        onShowAll={() => {}}
        onOpen={() => {}}
        onMarkHandled={() => {}}
        onComplete={() => {}}
        onJump={() => {}}
      />,
    );
    const dots = container.querySelectorAll("[aria-hidden]");
    expect(dots.length).toBeGreaterThan(0);
  });
});
