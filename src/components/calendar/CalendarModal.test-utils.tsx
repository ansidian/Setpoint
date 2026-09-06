import { act, fireEvent, screen } from "@testing-library/react";
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
