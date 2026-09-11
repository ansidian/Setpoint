import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { BarChart3 } from "lucide-react";
import { getAlfredUsageStats, getEmailAiUsageStats, getEmailSearchStats } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AlfredAnalyticsSection from "./analytics/AlfredAnalyticsSection";
import EmailSearchAnalyticsSection from "./analytics/EmailSearchAnalyticsSection";
import TriageAnalyticsSection from "./analytics/TriageAnalyticsSection";
import FinancialEmailAnalyticsSection from "./analytics/FinancialEmailAnalyticsSection";

import AnalyticsProviderFilter, { AnalyticsProviderComparison } from "./analytics/AnalyticsProviderFilter";
import { providerComparison, selectProviderStats, type AnalyticsTabKey, type AnalyticsProvider } from "./analytics/analyticsProviderData";

interface AnalyticsTab {
  key: AnalyticsTabKey;
  label: string;
  fetcher: () => Promise<unknown>;
  Section: ComponentType<{ stats: never }>;
}

interface SectionSlice {
  data?: unknown;
  error?: boolean;
  loading?: boolean;
}

type SectionState = Partial<Record<AnalyticsTabKey, SectionSlice>>;

const TABS: AnalyticsTab[] = [
  { key: "alfred", label: "Alfred", fetcher: getAlfredUsageStats, Section: AlfredAnalyticsSection as ComponentType<{ stats: never }> },
  { key: "search", label: "Email Search", fetcher: getEmailSearchStats, Section: EmailSearchAnalyticsSection as ComponentType<{ stats: never }> },
  { key: "triage", label: "Triage", fetcher: getEmailAiUsageStats, Section: TriageAnalyticsSection as ComponentType<{ stats: never }> },
  { key: "financial", label: "Financial email", fetcher: getEmailAiUsageStats, Section: FinancialEmailAnalyticsSection as ComponentType<{ stats: never }> },
];

// Each section fetches independently the first time the hub opens, so a slow or
// failing endpoint isolates to its own tab instead of blanking the whole modal.
// `retry` re-runs one tab's fetch from the error state (a click handler, so its
// synchronous setState is fine — unlike a synchronous reset inside the effect).
function useSectionData(open: boolean): [SectionState, (key: AnalyticsTabKey) => void] {
  // No key present yet ⇒ that tab renders its loading skeleton (see the
  // `|| { loading }` fallback in the component). The mount unmounts this modal on
  // close, so each open starts from a fresh empty map.
  const [state, setState] = useState<SectionState>({}); // { [key]: { data } | { error } }
  const aliveRef = useRef(false);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  const runFetch = useCallback((tab: AnalyticsTab) => {
    tab.fetcher()
      .then((data) => { if (aliveRef.current) setState((prev) => ({ ...prev, [tab.key]: { data } })); })
      .catch(() => { if (aliveRef.current) setState((prev) => ({ ...prev, [tab.key]: { error: true } })); });
  }, []);
  const retry = useCallback((key: AnalyticsTabKey) => {
    const tab = TABS.find((t) => t.key === key);
    if (!tab) return;
    setState((prev) => ({ ...prev, [key]: { loading: true } }));
    runFetch(tab);
  }, [runFetch]);
  useEffect(() => {
    if (!open) return undefined;
    for (const tab of TABS) runFetch(tab);
    return undefined;
  }, [open, runFetch]);
  return [state, retry];
}

// Fixed-dimension skeleton (hero grid + two boxes) so the loading→ready swap does
// not shift layout — the "dense, not stressful" rule from the design system.
function SectionSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-[82px] animate-pulse rounded-lg bg-white/[0.04] motion-reduce:animate-none" />
        ))}
      </div>
      <div className="h-16 animate-pulse rounded-lg bg-white/[0.03] motion-reduce:animate-none" />
      <div className="h-24 animate-pulse rounded-lg bg-white/[0.025] motion-reduce:animate-none" />
    </div>
  );
}

function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--sp-rose)]/20 bg-[var(--sp-rose)]/[0.08] p-4">
      <p className="text-[12px] leading-relaxed text-[var(--sp-rose)]">Couldn’t load this section.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2.5 min-h-11 rounded-md border border-[var(--sp-rose)]/30 bg-[var(--sp-rose)]/[0.10] px-2.5 py-1 text-[11px] font-medium text-[var(--sp-rose)] transition-[background-color,transform] duration-150 hover:bg-[var(--sp-rose)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sp-rose)]/50 motion-safe:hover:-translate-y-px motion-safe:focus-visible:-translate-y-px active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-0"
      >
        Try again
      </button>
    </div>
  );
}

export default function AiAnalyticsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState<AnalyticsTabKey>("alfred");
  const [provider, setProvider] = useState<AnalyticsProvider>("all");
  const [sections, retry] = useSectionData(open);


  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DialogContent
        data-testid="ai-analytics-modal"
        // Presence-based marker: the calendar's hotkey handler goes fully
        // inert while this blocking overlay is mounted (focus-independent).
        data-suspend-calendar-hotkeys="blocking"
        overlayClassName="bg-[var(--sp-deep)]/70"
        // Static CSS faux-frost over the flat dim scrim. Explicitly overrides the
        // DialogOverlay base `supports-backdrop-filter:backdrop-blur-xs` to none so
        // there is no live full-viewport blur re-rasterizing every frame the
        // dashboard animates behind it — and no per-open html-to-image snapshot.
        // The card is opaque and heavily dimmed here, so a top highlight + edge
        // vignette is all that reads; the gradient layers paint over bg-[#0b0b13]/70.
        overlayStyle={{
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          backgroundImage: [
            "radial-gradient(120% 90% at 50% -10%, rgba(120,130,170,0.10), transparent 60%)",
            "radial-gradient(140% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.30))",
            "linear-gradient(color-mix(in srgb, var(--sp-deep) 62%, transparent), color-mix(in srgb, var(--sp-deep) 74%, transparent))",
          ].join(", "),
        }}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border border-white/[0.08] bg-[var(--sp-panel)] p-0 text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.7)] sm:max-w-[760px] max-sm:[&>[data-slot=dialog-close]]:min-h-11 max-sm:[&>[data-slot=dialog-close]]:min-w-11 [&>[data-slot=dialog-close]]:transition-[background-color,transform] [&>[data-slot=dialog-close]]:hover:bg-white/10 [&>[data-slot=dialog-close]]:focus-visible:ring-2 [&>[data-slot=dialog-close]]:focus-visible:ring-primary/60 motion-safe:[&>[data-slot=dialog-close]]:hover:-translate-y-px motion-safe:[&>[data-slot=dialog-close]]:focus-visible:-translate-y-px [&>[data-slot=dialog-close]]:active:scale-95 motion-reduce:[&>[data-slot=dialog-close]]:transform-none motion-reduce:[&>[data-slot=dialog-close]]:transition-none"
      >
        <DialogHeader className="border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 hidden size-8 sm:flex shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/[0.10] text-primary">
              <BarChart3 size={16} />
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 pr-7">
              <DialogTitle className="text-[13px] font-semibold tracking-[1.8px] text-foreground uppercase">
                AI analytics
              </DialogTitle>
              <div className="col-start-2 row-start-1 sm:row-span-2">
                <AnalyticsProviderFilter value={provider} onChange={setProvider} />
              </div>
              <DialogDescription className="col-span-2 mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground/75 sm:col-span-1">
                Alfred, email search, triage, and financial-email model usage.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div role="tablist" aria-label="AI analytics sections" className="flex flex-wrap gap-1 border-b border-white/[0.06] px-4">
          {TABS.map((tab) => {
            const selected = tab.key === active;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setActive(tab.key)}
                className={`-mb-px min-h-11 rounded-t-md border-b-2 px-2.5 py-2.5 text-[11px] font-medium transition-[color,background-color,transform] duration-150 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-safe:hover:-translate-y-px motion-safe:focus-visible:-translate-y-px active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-0 ${
                  selected
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Overlapping grid cells reserve the tallest section/provider's natural height.
            Inactive panels affect sizing but cannot be seen, focused, or read. */}
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)]">
          {TABS.flatMap(({ key, Section }) => (["all", "openai", "anthropic"] as const).map((panelProvider) => {
            const slice = sections[key] || { loading: true };
            const selectedStats = selectProviderStats(key, slice.data, panelProvider);
            const comparison = providerComparison(key, slice.data);
            const selected = key === active && panelProvider === provider;
            return (
              <div
                key={`${key}-${panelProvider}`}
                role="tabpanel"
                aria-hidden={!selected}
                inert={!selected}
                aria-busy={Boolean(slice.loading)}
                className={`col-start-1 row-start-1 min-h-0 overflow-y-auto overscroll-contain p-5 ${selected ? "" : "invisible"}`}
              >
                {panelProvider === "all" && comparison && !slice.loading && !slice.error && (
                  <div className="mb-4"><AnalyticsProviderComparison comparison={comparison} /></div>
                )}
                {slice.loading ? <p role="status" className="sr-only">Loading analytics…</p> : null}
                {slice.loading ? <SectionSkeleton /> : null}
                {slice.error ? <SectionError onRetry={() => retry(key)} /> : null}
                {slice.data && key === "search" && panelProvider === "anthropic" ? (
                  <p className="text-[12px] leading-relaxed text-muted-foreground">Email Search embeddings use OpenAI. Anthropic has no embedding usage in this section.</p>
                ) : selectedStats ? <Section stats={selectedStats as never} /> : slice.data ? (
                  <p className="text-[12px] text-muted-foreground">Provider analytics are unavailable for this section.</p>
                ) : null}
              </div>
            );
          }))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
