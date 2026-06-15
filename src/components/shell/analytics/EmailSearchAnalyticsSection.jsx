import { DatabaseZap, Coins, Search } from "lucide-react";
import { Metric, Stat } from "./analyticsPrimitives.jsx";
import { formatUsdEstimate, formatCompactNumber, formatPercent, numberValue } from "./analyticsFormat.js";

export default function EmailSearchAnalyticsSection({ stats }) {
  const cov = stats?.coverage || {};
  const corpus = stats?.corpusEmbeddings || {};
  const query = stats?.querySearch?.actualUsage || {};
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Indexed" value={formatCompactNumber(cov.total_indexed)} icon={DatabaseZap} />
        <Metric label="Coverage" value={formatPercent(cov.coverage_ratio)} icon={Search} tone="accent" />
        <Metric label="Corpus cost" value={formatUsdEstimate(corpus.estimatedCostUsd)} icon={Coins} />
      </div>
      <div className="rounded-lg border border-white/[0.06] bg-black/[0.10] p-3">
        <div className="mb-3 text-[11px] font-semibold tracking-[1.4px] text-foreground uppercase">Corpus embeddings</div>
        <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <Stat label="Status" value={String(cov.semantic_status || "—")} />
          <Stat label="Fresh" value={formatCompactNumber(cov.fresh_embeddings)} />
          <Stat label="Stale" value={formatCompactNumber(cov.stale_embeddings)} />
          <Stat label="Missing" value={formatCompactNumber(cov.missing_embeddings)} />
        </div>
      </div>
      <div className="rounded-lg border border-white/[0.06] bg-black/[0.10] p-3">
        <div className="mb-3 text-[11px] font-semibold tracking-[1.4px] text-foreground uppercase">Query embeddings</div>
        <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
          <Stat label="Searches" value={numberValue(query.calls)} />
          <Stat label="Tokens" value={formatCompactNumber(query.inputTokens)} />
          <Stat label="Cost" value={formatUsdEstimate(query.estimatedCostUsd)} />
        </div>
      </div>
    </div>
  );
}
