import { ArrowDownToLine, Bot, ChevronDown, Coins, Gauge, Layers3, Timer, TriangleAlert } from "lucide-react";
import type { AiUsagePurpose, AiUsageTotals, EmailAiUsageStats } from "../../../../shared/types/ai-usage";
import { isDemoMode } from "@/demo/config";
import { Metric, Stat } from "./analyticsPrimitives";
import { formatCompactNumber, formatUsdEstimate } from "./analyticsFormat";

const PURPOSES: Record<"triage" | "financialEmail", { key: AiUsagePurpose; label: string }[]> = {
  triage: [{ key: "triage_cheap", label: "Cheap pass" }, { key: "triage_strong", label: "Strong pass" }],
  financialEmail: [{ key: "extraction", label: "Extraction" }, { key: "verification", label: "Verification" }, { key: "matching", label: "Matching" }],
};

function measured(value: number | null | undefined, calls: number, format: (value: number) => string = formatCompactNumber): string {
  return calls === 0 ? format(0) : value == null ? "Unknown" : format(value);
}

function latency(value: number): string {
  return value < 1000 ? Math.round(value) + " ms" : (value / 1000).toFixed(1) + " s";
}

function coverageNote(stats?: AiUsageTotals): string {
  return [
    stats?.missingUsageCalls ? "Partial tokens (" + stats.missingUsageCalls + " missing usage)" : null,
    stats?.unpricedCalls ? stats.unpricedCalls + " unpriced" : null,
    stats?.pendingCalls ? stats.pendingCalls + " outcome unknown" : null,
  ].filter(Boolean).join(" · ");
}

export default function EmailAiUsageSection({ stats, category }: {
  stats: EmailAiUsageStats;
  category: "triage" | "financialEmail";
}) {
  const usage = stats.contexts.production[category];
  const note = coverageNote(usage);
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">Last {stats.windowDays} days{isDemoMode() ? " · Fictional demo data" : ""}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Calls" value={formatCompactNumber(usage.calls)} icon={Bot} />
        <Metric label={usage.unpricedCalls ? "Known cost" : "Est. cost"} value={measured(usage.estimatedCostUsd, usage.calls, formatUsdEstimate)} icon={Coins} tone="accent" />
        <Metric label="Avg. call" value={usage.calls ? measured(usage.averageProviderLatencyMs, usage.calls, latency) : "—"} icon={Timer} />
        <Metric label="Input" value={measured(usage.inputTokens, usage.calls)} icon={ArrowDownToLine} />
        <Metric label="Output" value={measured(usage.outputTokens, usage.calls)} icon={Layers3} />
        <Metric label="Failures" value={formatCompactNumber(usage.failures)} icon={TriangleAlert} tone={usage.failures ? "error" : "neutral"} />
      </div>
      {note && <p className="text-[10px] leading-relaxed text-muted-foreground">{note}</p>}

      {usage.calls === 0 ? (
        <p className="py-2 text-[12px] text-muted-foreground">No calls in this window.</p>
      ) : (
        <>
          <section aria-label="Cache tokens" className="rounded-lg border border-primary/15 bg-primary/[0.08] p-3">
            <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-[1.4px] text-primary uppercase"><Gauge size={13} />Cache tokens</h3>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Read" value={measured(usage.cachedInputTokens, usage.calls)} />
              <Stat label="Write" value={measured(usage.cacheCreationInputTokens, usage.calls)} />
            </div>
          </section>

          <section aria-label="Call breakdown" className="rounded-lg border border-white/[0.06] bg-black/[0.10] p-3">
            <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-[1.4px] text-foreground uppercase"><Layers3 size={13} className="text-[var(--sp-blue)]" />Call breakdown</h3>
            <table className="w-full text-left text-[11px] tabular-nums">
              <thead className="text-[9px] font-semibold tracking-[1px] text-muted-foreground/75 uppercase">
                <tr><th scope="col" className="pb-2 font-semibold">Pass</th><th scope="col" className="pb-2 text-right font-semibold">Calls</th><th scope="col" className="pb-2 pl-2 text-right font-semibold">Failed</th><th scope="col" className="pb-2 pl-2 text-right font-semibold">{usage.unpricedCalls ? "Known $" : "Cost"}</th><th scope="col" className="pb-2 pl-2 text-right font-semibold">Avg.</th></tr>
              </thead>
              <tbody>
                {PURPOSES[category].map(({ key, label }) => {
                  const purpose = usage.byPurpose[key];
                  const calls = purpose?.calls ?? 0;
                  return (
                    <tr key={key} className="border-t border-white/[0.04]">
                      <th scope="row" className="py-2 pr-2 font-medium text-foreground">{label}</th>
                      <td className="py-2 text-right text-foreground">{calls}</td>
                      <td className={"py-2 pl-2 text-right " + (purpose?.failures ? "text-[var(--sp-rose)]" : "text-muted-foreground/75")}>{purpose?.failures ?? 0}</td>
                      <td className="whitespace-nowrap py-2 pl-2 text-right text-primary">{measured(purpose?.estimatedCostUsd, calls, formatUsdEstimate)}</td>
                      <td className="whitespace-nowrap py-2 pl-2 text-right text-muted-foreground/75">{calls ? measured(purpose?.averageProviderLatencyMs, calls, latency) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}

      <details className="group text-[11px] text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md py-1 transition-[color,transform] duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-safe:hover:translate-x-px motion-safe:focus-visible:translate-x-px active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-0 [&::-webkit-details-marker]:hidden">
          <ChevronDown size={12} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />Usage details
        </summary>
        <div className="space-y-2 pt-2 leading-relaxed">
          <p>{category === "financialEmail" ? "Extraction, verification, and Actual target matching. Initial classification is counted in Triage." : "Initial classification only, including financial-email classification."} Cached reuse and deterministic checks do not count as calls.</p>
          <p>Tracked since {new Date(stats.ledgerStartedAt).toLocaleDateString()}; earlier calls are excluded. Unknown means usage was not reported. Partial totals include known measurements only. Unknown outcomes are not counted as failures.</p>
          <p>Cost is an estimate. Average call time measures the provider request, not the full workflow.</p>
          {usage.models.length > 0 && <p className="break-words">Models: {usage.models.join(", ")}</p>}
          {usage.calls > 0 && PURPOSES[category].map(({ key, label }) => {
            const purpose = usage.byPurpose[key];
            const calls = purpose?.calls ?? 0;
            return (
              <div key={key} className="border-t border-white/[0.06] pt-2">
                <h4 className="font-medium text-foreground">{label}</h4>
                <dl className="mt-1 grid grid-cols-2 gap-2 tabular-nums">
                  <div><dt>Input / output</dt><dd className="text-foreground">{measured(purpose?.inputTokens, calls)} / {measured(purpose?.outputTokens, calls)}</dd></div>
                  <div><dt>Cache read / write</dt><dd className="text-foreground">{measured(purpose?.cachedInputTokens, calls)} / {measured(purpose?.cacheCreationInputTokens, calls)}</dd></div>
                </dl>
                {coverageNote(purpose) && <p className="mt-1 text-[10px]">{coverageNote(purpose)}</p>}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
