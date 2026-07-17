import { act, fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import { DashboardProvider } from "../../context/DashboardContext";

export function wrapWithDashboard(node) {
  return (
    <DashboardProvider
      deadlines={{ upcoming: [] }}
      setCalendarDeadlines={() => {}}
    >
      {node}
    </DashboardProvider>
  );
}

export function getLatestRailContent() {
  const railContent = screen.getAllByTestId("calendar-rail-content");
  return railContent[railContent.length - 1];
}

export async function flushAnimationFrame() {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  });
}

export function pointerClick(element) {
  fireEvent.pointerDown(element);
  fireEvent.click(element);
}

export function stubRect(element, rect) {
  element.getBoundingClientRect = vi.fn(() => ({
    width: 100,
    height: 24,
    left: 0,
    right: 100,
    bottom: 124,
    ...rect,
  }));
}
