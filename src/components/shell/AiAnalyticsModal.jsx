import { useEffect, useState } from "react";
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
function useSectionData(open) {
  // No key present yet ⇒ that tab renders its loading state (see the `|| { loading }`
  // fallback below), so the effect only needs to publish results, never a synchronous
  // "everything is loading" reset. The mount unmounts this modal on close, so each
  // open starts from a fresh empty map.
  const [state, setState] = useState({}); // { [key]: { data } | { error } }
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    for (const tab of TABS) {
      tab.fetcher()
        .then((data) => { if (alive) setState((prev) => ({ ...prev, [tab.key]: { data } })); })
        .catch(() => { if (alive) setState((prev) => ({ ...prev, [tab.key]: { error: true } })); });
    }
    return () => { alive = false; };
  }, [open]);
  return state;
}

export default function AiAnalyticsModal({ open, onClose, backdropSnapshot = null }) {
  const [active, setActive] = useState("alfred");
  const sections = useSectionData(open);
  const current = TABS.find((tab) => tab.key === active);
  const slice = sections[active] || { loading: true };
  const Section = current.Section;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DialogContent
        data-testid="ai-analytics-modal"
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
                Alfred assistant usage, email-search retrieval cost, and triage model spend.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 pt-4">
          <div role="tablist" aria-label="AI analytics sections" className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={tab.key === active}
                onClick={() => setActive(tab.key)}
                className="rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none aria-selected:bg-white/[0.10] aria-selected:text-foreground"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 pt-3">
          {slice.loading ? <div className="text-[12px] text-muted-foreground/65">Loading…</div> : null}
          {slice.error ? <div className="text-[12px] text-[#f38ba8]">Couldn’t load this section.</div> : null}
          {slice.data ? <Section stats={slice.data} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
