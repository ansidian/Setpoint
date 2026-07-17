import { createElement } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { numberValue, formatUsdEstimate, formatCompactNumber } from "./analyticsFormat";

export interface MetricProps {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: "neutral" | "accent" | "success";
}

export function Metric({ label, value, icon: Icon, tone = "neutral" }: MetricProps) {
  const color = tone === "accent" ? "var(--sp-accent)" : tone === "success" ? "var(--sp-green)" : "var(--sp-subtext)";
  return (
    <div
      className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3"
      style={{ minHeight: 82 }}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[1.4px] text-muted-foreground/75 uppercase">
        {createElement(Icon, { size: 13, style: { color } })}
        {label}
      </div>
      <div className="mt-3 text-[22px] font-semibold leading-none text-foreground">
        {value}
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-semibold tracking-[1.3px] text-muted-foreground/75 uppercase">
        {label}
      </div>
      <div className="mt-1 text-[13px] font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

interface TierStats {
  calls?: unknown;
  estimatedCostUsd?: unknown;
  inputTokens?: unknown;
}

export function TierRow({ label, stats }: { label: string; stats?: TierStats }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/[0.10] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold tracking-[1.4px] text-foreground uppercase">
          {label}
        </div>
        <div className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold tracking-[1.2px] text-muted-foreground uppercase">
          {numberValue(stats?.calls)} calls
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Stat label="Cost" value={formatUsdEstimate(stats?.estimatedCostUsd)} />
        <Stat label="Input" value={formatCompactNumber(stats?.inputTokens)} />
      </div>
    </div>
  );
}
