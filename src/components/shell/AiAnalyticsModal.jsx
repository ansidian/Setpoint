import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import { getAlfredUsageStats, getEmailSearchStats, getTriageCacheStats } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AlfredAnalyticsSection from "./analytics/AlfredAnalyticsSection.jsx";
import EmailSearchAnalyticsSection from "./analytics/EmailSearchAnalyticsSection.jsx";
import TriageAnalyticsSection from "./analytics/TriageAnalyticsSection.jsx";

const TABS = [
  { key: "alfred", label: "Alfred", fetcher: getAlfredUsageStats, Section: AlfredAnalyticsSection },
  { key: "search", label: "Email Search", fetcher: getEmailSearchStats, Section: EmailSearchAnalyticsSection },
  { key: "triage", label: "Triage", fetcher: getTriageCacheStats, Section: TriageAnalyticsSection },
];

// Each section fetches independently the first time the hub opens, so a slow or
// failing endpoint isolates to its own tab instead of blanking the whole modal.
// `retry` re-runs one tab's fetch from the error state (a click handler, so its
// synchronous setState is fine — unlike a synchronous reset inside the effect).
function useSectionData(open) {
  // No key present yet ⇒ that tab renders its loading skeleton (see the
  // `|| { loading }` fallback in the component). The mount unmounts this modal on
  // close, so each open starts from a fresh empty map.
  const [state, setState] = useState({}); // { [key]: { data } | { error } }
  const aliveRef = useRef(false);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  const runFetch = useCallback((tab) => {
    tab.fetcher()
      .then((data) => { if (aliveRef.current) setState((prev) => ({ ...prev, [tab.key]: { data } })); })
      .catch(() => { if (aliveRef.current) setState((prev) => ({ ...prev, [tab.key]: { error: true } })); });
  }, []);
  const retry = useCallback((key) => {
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

function SectionError({ onRetry }) {
  return (
    <div className="rounded-lg border border-[var(--sp-rose)]/20 bg-[var(--sp-rose)]/[0.08] p-4">
      <p className="text-[12px] leading-relaxed text-[var(--sp-rose)]">Couldn’t load this section.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2.5 rounded-md border border-[var(--sp-rose)]/30 bg-[var(--sp-rose)]/[0.10] px-2.5 py-1 text-[11px] font-medium text-[var(--sp-rose)] transition-colors duration-150 hover:bg-[var(--sp-rose)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sp-rose)]/50"
      >
        Try again
      </button>
    </div>
  );
}

export default function AiAnalyticsModal({ open, onClose }) {
  const [active, setActive] = useState("alfred");
  const [sections, retry] = useSectionData(open);
  const current = TABS.find((tab) => tab.key === active);
  const slice = sections[active] || { loading: true };
  const Section = current.Section;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DialogContent
        data-testid="ai-analytics-modal"
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
        className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto border border-white/[0.08] bg-[var(--sp-panel)] p-0 text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.7)] sm:max-w-[760px]"
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
              <DialogDescription className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground/75">
                Alfred assistant usage, email-search retrieval cost, and triage model spend.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div role="tablist" aria-label="AI analytics sections" className="flex gap-1 border-b border-white/[0.06] px-4">
          {TABS.map((tab) => {
            const selected = tab.key === active;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setActive(tab.key)}
                className={`-mb-px rounded-t-md border-b-2 px-3 py-2.5 text-[12px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
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

        <div role="tabpanel" className="p-5">
          {slice.loading ? <SectionSkeleton /> : null}
          {slice.error ? <SectionError onRetry={() => retry(active)} /> : null}
          {slice.data ? <Section stats={slice.data} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
