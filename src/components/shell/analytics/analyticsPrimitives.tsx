import { createElement } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface MetricProps {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: "neutral" | "accent" | "success" | "error";
}

export function Metric({ label, value, icon: Icon, tone = "neutral" }: MetricProps) {
  const color = tone === "accent" ? "var(--sp-accent)" : tone === "success" ? "var(--sp-green)" : tone === "error" ? "var(--sp-rose)" : "var(--sp-subtext)";
  return (
    <div
      role="group"
      aria-label={label}
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
