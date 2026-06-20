import { useMemo } from "react";
import { Bot, Gauge, Coins, BarChart3, Layers3, Wrench } from "lucide-react";
import { Metric } from "./analyticsPrimitives.jsx";
import { formatPercent, formatUsdEstimate, formatCompactNumber, numberValue, formatModelName } from "./analyticsFormat.js";

// A small, on-brand rotation (lavender accent, info blue, income cyan, success
// green) so each model is visually distinct in the split without inventing
// decorative colors. Order is stable per render via the row index.
const MODEL_ACCENTS = ["var(--sp-accent)", "var(--sp-blue)", "var(--sp-cyan)", "var(--sp-green)"];

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
        {metrics.map((metric) => <Metric key={metric.label} {...metric} />)}
      </div>

      <div className="rounded-lg border border-primary/15 bg-primary/[0.08] p-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[1.4px] text-primary uppercase">
          <Gauge size={13} />
          Cache read
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-foreground/85">
          Saved {formatPercent(stats?.cacheHitRate)} of input tokens via the cached tool and transcript prefix.
        </p>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-black/[0.10] p-3">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-[1.4px] text-foreground uppercase">
          <Wrench size={13} className="text-[var(--sp-blue)]" />
          Tools used
        </div>
        {tools.length === 0 ? (
          <div className="text-[12px] text-muted-foreground/75">No tool calls in this window.</div>
        ) : (
          <div className="space-y-0.5">
            <div className="grid grid-cols-[1fr_3.5rem_3rem_4rem] gap-x-3 px-1.5 pb-1 text-[9px] font-semibold tracking-[1.3px] text-muted-foreground/75 uppercase">
              <span>Tool</span>
              <span className="text-right">Calls</span>
              <span className="text-right">Err</span>
              <span className="text-right">Avg</span>
            </div>
            {tools.map((tool) => {
              const hasErr = numberValue(tool.errors) > 0;
              return (
                <div key={tool.name} className="grid grid-cols-[1fr_3.5rem_3rem_4rem] items-center gap-x-3 rounded-md px-1.5 py-1 text-[11px] text-foreground/85 odd:bg-white/[0.015]">
                  <span className="truncate font-medium">{tool.name}</span>
                  <span className="text-right tabular-nums text-foreground">{numberValue(tool.calls)}</span>
                  <span className={`text-right tabular-nums ${hasErr ? "text-[var(--sp-rose)]" : "text-muted-foreground/75"}`}>
                    {formatPercent(tool.errorRate)}
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground/75">{numberValue(tool.avgDurationMs)}ms</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {models.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-black/[0.10] p-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[1.4px] text-foreground uppercase">
            <Layers3 size={13} className="text-primary/80" />
            Model split
          </div>
          <p className="mt-1 mb-3 text-[10px] leading-relaxed text-muted-foreground/75">
            Model API calls (turns) and estimated cost per model. One query can span several turns.
          </p>
          <div className="space-y-1.5">
            {models.map(([id, model], index) => (
              <div key={id} className="flex items-center justify-between gap-3 rounded-md border border-white/[0.04] bg-white/[0.02] px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: MODEL_ACCENTS[index % MODEL_ACCENTS.length] }}
                  />
                  <span className="truncate text-[12px] font-medium text-foreground" title={id}>
                    {formatModelName(id)}
                  </span>
                </div>
                <div className="flex shrink-0 items-baseline gap-3 text-[11px]">
                  <span className="tabular-nums text-muted-foreground/75">{numberValue(model.calls)} calls</span>
                  <span className="tabular-nums font-semibold text-primary">{formatUsdEstimate(model.estimatedCostUsd)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
