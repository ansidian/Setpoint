import { act, fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext";
import type { ComponentType, ReactNode } from "react";

const DashboardProviderCompat = DashboardProvider as unknown as ComponentType<Record<string, unknown> & { children: ReactNode }>;

export function wrapWithDashboard(node: ReactNode) {
  return (
    <DashboardProviderCompat
      deadlines={{ upcoming: [] }}
      setCalendarDeadlines={() => {}}
    >
      {node}
    </DashboardProviderCompat>
  );
}

export function getLatestRailContent() {
  const railContent = screen.getAllByTestId("calendar-rail-content");
  return railContent[railContent.length - 1]!;
}

export async function flushAnimationFrame() {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });
}

export function pointerClick(element: Element) {
  fireEvent.pointerDown(element);
  fireEvent.click(element);
}

export function stubRect(element: HTMLElement, rect: Partial<DOMRect> = {}) {
  element.getBoundingClientRect = vi.fn(() => ({
    width: 100,
    height: 24,
    left: 0,
    right: 100,
    bottom: 124,
    ...rect,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect));
}
