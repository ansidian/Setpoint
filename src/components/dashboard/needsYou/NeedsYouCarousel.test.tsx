import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NeedsYouCarousel } from "./NeedsYouCarousel";
import type { NeedsYouCard } from "./needsYouModel";

afterEach(() => { cleanup(); vi.useRealTimers(); });

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
  it("sets touch-action to 'pan-x pan-y' to allow vertical page scroll to start on the carousel", () => {
    render(
      <NeedsYouCarousel
        urgentCards={[createUrgentCard(1), createUrgentCard(2)]}
        backfillCards={[]}
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

  it("announces the current slide position via a polite live region", () => {
    render(
      <NeedsYouCarousel
        urgentCards={[
          createUrgentCard(1, "First card"),
          createUrgentCard(2, "Second card"),
          createUrgentCard(3, "Third card"),
        ]}
        backfillCards={[]}
        onOpen={() => {}}
        onMarkHandled={() => {}}
        onComplete={() => {}}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("First card")).toBeTruthy();
    expect(screen.getByText("Second card")).toBeTruthy();
    expect(screen.getByText("Third card")).toBeTruthy();
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Card 1 of 3");
  });

  it("keeps the position dots hidden from assistive tech", () => {
    render(
      <NeedsYouCarousel
        urgentCards={[createUrgentCard(1), createUrgentCard(2)]}
        backfillCards={[]}
        onOpen={() => {}}
        onMarkHandled={() => {}}
        onComplete={() => {}}
        onJump={() => {}}
      />,
    );
    const dotsContainer = screen.getByTestId("needs-you-carousel-dots");
    const dots = Array.from(dotsContainer.querySelectorAll("[data-carousel-position-dot]"));
    expect(dots).toHaveLength(2);
    expect(dots.every((dot) => dot.getAttribute("aria-hidden") === "true")).toBe(true);
  });
});
