import { useMemo } from "react";
import { Bot, Coins, Layers3 } from "lucide-react";
import { Metric, TierRow } from "./analyticsPrimitives.jsx";
import { formatUsdEstimate, formatCompactNumber, numberValue } from "./analyticsFormat.js";

export default function TriageAnalyticsSection({ stats }) {
  const metrics = useMemo(() => ([
    { label: "Triage calls", value: numberValue(stats?.openaiCalls), icon: Bot },
    { label: "Triage cost", value: formatUsdEstimate(stats?.estimatedCostUsd), icon: Coins },
    { label: "Output", value: formatCompactNumber(stats?.outputTokens), icon: Layers3 },
  ]), [stats]);
  const models = stats?.models?.length ? stats.models : ["No models in this window"];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {metrics.map((m) => <Metric key={m.label} {...m} />)}
      </div>
      <TierRow label="Cheap" stats={stats?.byTier?.cheap} />
      <TierRow label="Strong" stats={stats?.byTier?.strong} />
      <div className="flex flex-wrap gap-1.5">
        {models.map((m) => (
          <span key={m} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] tracking-[1.2px] text-muted-foreground uppercase">{m}</span>
        ))}
      </div>
    </div>
  );
}
