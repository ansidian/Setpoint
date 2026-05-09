import { createElement, useEffect, useMemo, useState } from "react";
import { BarChart3, Bot, Coins, DatabaseZap, Gauge, Layers3, Search } from "lucide-react";
import { getTriageCacheStats } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatPercent(value) {
  return `${(numberValue(value) * 100).toFixed(1)}%`;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numberValue(value)).toLowerCase();
}

function formatUsdEstimate(value) {
  const number = numberValue(value);
  if (number > 0 && number < 0.0001) return "<$0.0001";
  if (number > 0 && number < 0.01) return `$${number.toFixed(4)}`;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(number);
}

function formatDateTime(value) {
  if (!value) return "No recent OpenAI triage";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent OpenAI triage";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function savingsRate(stats) {
  const cost = numberValue(stats?.estimatedCostUsd);
  const saved = numberValue(stats?.estimatedSavingsUsd);
  const uncachedEstimate = cost + saved;
  if (!uncachedEstimate) return "0.0%";
  return formatPercent(saved / uncachedEstimate);
}

function Metric({ label, value, icon: Icon, tone = "neutral" }) {
  const color = tone === "accent" ? "#cba6da" : tone === "success" ? "#a6e3a1" : "#a6adc8";
  return (
    <div
      className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3"
      style={{ minHeight: 82 }}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[1.4px] text-muted-foreground/65 uppercase">
        {createElement(Icon, { size: 13, style: { color } })}
        {label}
      </div>
      <div className="mt-3 text-[22px] font-semibold leading-none text-foreground">
        {value}
      </div>
    </div>
  );
}

function TierRow({ label, stats }) {
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
      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <Stat label="Cost" value={formatUsdEstimate(stats?.estimatedCostUsd)} />
        <Stat label="Saved" value={formatUsdEstimate(stats?.estimatedSavingsUsd)} />
        <Stat label="Input" value={formatCompactNumber(stats?.inputTokens)} />
        <Stat label="Cached" value={formatCompactNumber(stats?.cachedInputTokens)} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[9px] font-semibold tracking-[1.3px] text-muted-foreground/55 uppercase">
        {label}
      </div>
      <div className="mt-1 text-[13px] font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

function SemanticSearchAnalytics({ stats }) {
  const semantic = stats?.semanticSearch;
  if (!semantic) return null;
  const coverage = semantic.coverage || {};
  const corpus = semantic.corpusEmbeddings || {};
  const askAi = semantic.askAi || {};
  const actual = askAi.actualUsage || {};
  const estimate = askAi.perSuccessfulAskEstimate || {};
  const coveragePercent = formatPercent(coverage.coverage_ratio);
  const askCost = formatUsdEstimate(actual.estimatedCostUsd);

  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-[#89b4fa]/20 bg-[#89b4fa]/10 p-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[1.4px] text-[#89b4fa] uppercase">
          <Search size={13} />
          Semantic search
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-foreground/85">
          Ask AI spent {askCost} in this window. Vector coverage is {coveragePercent}.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/65">
          Corpus cost estimates the current stored embedding set; per-ask estimate includes planner, query vector, and capped answer.
        </p>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-semibold tracking-[1.4px] text-muted-foreground uppercase">
            Semantic search details
          </div>
          <div className="rounded-full border border-white/[0.08] bg-black/[0.12] px-2 py-1 text-[10px] font-semibold tracking-[1.2px] text-muted-foreground uppercase">
            {coverage.semantic_status || "unknown"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Coverage" value={coveragePercent} />
          <Stat label="Fresh vectors" value={`${numberValue(coverage.fresh_embeddings)} / ${numberValue(coverage.total_indexed)}`} />
          <Stat label="Corpus cost" value={formatUsdEstimate(corpus.estimatedCostUsd)} />
          <Stat label="Ask AI cost" value={askCost} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Ask AI calls" value={numberValue(actual.calls)} />
          <Stat label="Input" value={formatCompactNumber(actual.inputTokens)} />
          <Stat label="Output" value={formatCompactNumber(actual.outputTokens)} />
          <Stat label="Per ask est." value={formatUsdEstimate(estimate.estimatedCostUsd)} />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/65">
          Actual Ask AI usage is logged as aggregate tokens only.
        </p>
      </div>
    </div>
  );
}

function SemanticSearchHeroMetrics({ stats }) {
  const semantic = stats?.semanticSearch;
  if (!semantic) return null;
  const coverage = semantic.coverage || {};
  const corpus = semantic.corpusEmbeddings || {};
  const askAi = semantic.askAi || {};
  const actual = askAi.actualUsage || {};
  const estimate = askAi.perSuccessfulAskEstimate || {};

  const metrics = [
    { label: "Ask AI cost", value: formatUsdEstimate(actual.estimatedCostUsd), icon: Search, tone: "accent" },
    { label: "Ask AI calls", value: numberValue(actual.calls), icon: Bot },
    { label: "Coverage", value: formatPercent(coverage.coverage_ratio), icon: Gauge, tone: "success" },
    { label: "Corpus est.", value: formatUsdEstimate(corpus.estimatedCostUsd), icon: Coins },
    { label: "Per ask est.", value: formatUsdEstimate(estimate.estimatedCostUsd), icon: BarChart3 },
    { label: "Vectors", value: `${numberValue(coverage.fresh_embeddings)} / ${numberValue(coverage.total_indexed)}`, icon: DatabaseZap },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metrics.map((metric) => (
        <Metric key={metric.label} {...metric} />
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-3">
      <div className="h-20 animate-pulse rounded-lg bg-white/[0.04]" />
      <div className="h-28 animate-pulse rounded-lg bg-white/[0.035]" />
      <div className="h-20 animate-pulse rounded-lg bg-white/[0.03]" />
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-lg border border-[#f38ba8]/20 bg-[#f38ba8]/10 p-4 text-[12px] leading-relaxed text-[#f38ba8]">
      AI triage analytics are unavailable right now.
    </div>
  );
}

function AnalyticsBody({ stats }) {
  const monthToDate = stats?.comparisonWindows?.monthToDate;
  const models = stats?.models?.length ? stats.models : ["No OpenAI models in this window"];
  const derivedSavingsRate = savingsRate(stats);
  const windowDays = numberValue(stats?.windowDays || 7);

  const metrics = useMemo(() => ([
    { label: "Hit rate", value: formatPercent(stats?.hitRate), icon: Gauge, tone: "accent" },
    { label: "Triage calls", value: numberValue(stats?.openaiCalls), icon: Bot },
    { label: "Cached", value: formatCompactNumber(stats?.cachedInputTokens), icon: DatabaseZap, tone: "success" },
    { label: "Triage cost", value: formatUsdEstimate(stats?.estimatedCostUsd), icon: Coins },
    { label: "Saved", value: formatUsdEstimate(stats?.estimatedSavingsUsd), icon: BarChart3, tone: "success" },
    { label: "Output", value: formatCompactNumber(stats?.outputTokens), icon: Layers3 },
  ]), [stats]);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map((metric) => (
          <Metric key={metric.label} {...metric} />
        ))}
      </div>

      <div className="rounded-lg border border-primary/15 bg-primary/[0.08] p-3">
        <div className="text-[11px] font-semibold tracking-[1.4px] text-primary uppercase">
          Cache read
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-foreground/85">
          Saved {derivedSavingsRate} versus an uncached estimate.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/65">
          Hit rate can fall when new uncached calls add input tokens to the rolling denominator, even if cached tokens stay flat.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="mb-3 text-[11px] font-semibold tracking-[1.4px] text-muted-foreground uppercase">
            {windowDays}-day window
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Input tokens" value={formatCompactNumber(stats?.inputTokens)} />
            <Stat label="Cached tokens" value={formatCompactNumber(stats?.cachedInputTokens)} />
            <Stat label="Output tokens" value={formatCompactNumber(stats?.outputTokens)} />
            <Stat label="Last triaged" value={formatDateTime(stats?.lastTriagedAt)} />
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="mb-3 text-[11px] font-semibold tracking-[1.4px] text-muted-foreground uppercase">
            Month to date
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Calls" value={numberValue(monthToDate?.openaiCalls)} />
            <Stat label="Hit rate" value={formatPercent(monthToDate?.hitRate)} />
            <Stat label="Cost" value={formatUsdEstimate(monthToDate?.estimatedCostUsd)} />
            <Stat label="Saved" value={formatUsdEstimate(monthToDate?.estimatedSavingsUsd)} />
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        <TierRow label="Cheap tier" stats={stats?.byTier?.cheap} />
        <TierRow label="Strong tier" stats={stats?.byTier?.strong} />
      </div>

      <SemanticSearchHeroMetrics stats={stats} />
      <SemanticSearchAnalytics stats={stats} />

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
        <div className="mb-2 text-[11px] font-semibold tracking-[1.4px] text-muted-foreground uppercase">
          Models
        </div>
        <div className="flex flex-wrap gap-2">
          {models.map((model) => (
            <span
              key={model}
              className="rounded-full border border-white/[0.08] bg-black/[0.12] px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            >
              {model}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TriageAnalyticsModal({ open, onClose, backdropSnapshot = null }) {
  const [stats, setStats] = useState(null);
  const [state, setState] = useState("idle");

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setState("loading");
    });
    getTriageCacheStats({ semantic: true })
      .then((nextStats) => {
        if (cancelled) return;
        setStats(nextStats);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DialogContent
        data-testid="triage-analytics-modal"
        overlayClassName="bg-[#0b0b13]/70"
        overlayStyle={{
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          ...(backdropSnapshot?.dataUrl
            ? {
                backgroundImage: `linear-gradient(rgba(11,11,19,0.54), rgba(11,11,19,0.68)), url("${backdropSnapshot.dataUrl}")`,
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "cover",
              }
            : {}),
        }}
        className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto border border-white/[0.08] bg-[#16161e] p-0 text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.7)] sm:max-w-[760px]"
      >
        <DialogHeader className="border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/[0.10] text-primary">
              <BarChart3 size={16} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[13px] font-semibold tracking-[1.8px] text-foreground uppercase">
                AI analytics
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground/70">
                OpenAI triage cost, prompt-cache behavior, model use, and semantic search estimates.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="p-5">
          {state === "loading" ? <LoadingState /> : null}
          {state === "error" ? <ErrorState /> : null}
          {state === "ready" ? <AnalyticsBody stats={stats} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
