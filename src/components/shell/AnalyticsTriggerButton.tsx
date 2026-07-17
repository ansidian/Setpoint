import { BarChart3 } from "lucide-react";
import { Kbd } from "./Kbd";

export function AnalyticsTriggerButton({ active = false, onOpenAnalytics }: { active?: boolean; onOpenAnalytics: () => void }) {
  return (
    <button
      type="button"
      className="analytics-trigger-button"
      aria-label="Open analytics"
      aria-pressed={active}
      onClick={onOpenAnalytics}
    >
      <BarChart3 size={11} />
      <span>Analytics</span>
      <Kbd>A</Kbd>
    </button>
  );
}
