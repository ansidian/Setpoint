import { useMemo } from "react";
import { Bot, Gauge, Coins, BarChart3, Layers3, Wrench } from "lucide-react";
import { Metric, Stat } from "./analyticsPrimitives.jsx";
import { formatPercent, formatUsdEstimate, formatCompactNumber, numberValue } from "./analyticsFormat.js";

export default function AlfredAnalyticsSection({ stats }) {
  const metrics = useMemo(() => ([
    { label: "Queries", value: numberValue(stats?.queries), icon: Bot },
    { label: "Tool calls", value: numberValue(stats?.tools?.totalCalls), icon: Wrench },
    { label: "Cache hit", value: formatPercent(stats?.cacheHitRate), icon: Gauge, tone: "accent" },
    { label: "Est. saved", value: formatUsdEstimate(stats?.estimatedSavingsUsd), icon: BarChart3, tone: "success" },
    { label: "Cost", value: formatUsdEstimate(stats?.estimatedCostUsd), icon: Coins },
    { label: "Output", value: formatCompactNumber(stats?.outputTokens), icon: Layers3 },
  ]), [stats]);
  const tools = stats?.tools?.byTool || [];
  const models = Object.entries(stats?.byModel || {});

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map((m) => <Metric key={m.label} {...m} />)}
      </div>

      <div className="rounded-lg border border-primary/15 bg-primary/[0.08] p-3">
        <div className="text-[11px] font-semibold tracking-[1.4px] text-primary uppercase">Cache read</div>
        <p className="mt-2 text-[12px] leading-relaxed text-foreground/85">
          Saved {formatPercent(stats?.cacheHitRate)} of input tokens via the cached tool + transcript prefix.
        </p>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-black/[0.10] p-3">
        <div className="mb-3 text-[11px] font-semibold tracking-[1.4px] text-foreground uppercase">Tools used</div>
        <div className="space-y-1.5">
          {tools.length === 0 && <div className="text-[12px] text-muted-foreground/65">No tool calls in this window.</div>}
          {tools.map((t) => (
            <div key={t.name} className="grid grid-cols-4 gap-2 text-[11px] text-foreground/85">
              <span className="col-span-1 font-medium">{t.name}</span>
              <Stat label="calls" value={numberValue(t.calls)} />
              <Stat label="err" value={formatPercent(t.errorRate)} />
              <Stat label="avg ms" value={numberValue(t.avgDurationMs)} />
            </div>
          ))}
        </div>
      </div>

      {models.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-black/[0.10] p-3">
          <div className="mb-3 text-[11px] font-semibold tracking-[1.4px] text-foreground uppercase">Model split</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {models.map(([id, m]) => (
              <Stat key={id} label={id} value={`${numberValue(m.calls)} · ${formatUsdEstimate(m.estimatedCostUsd)}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
