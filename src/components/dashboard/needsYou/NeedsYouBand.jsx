import { memo, useMemo, useState, useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { buildNeedsYouModel } from "./needsYouModel.js";
import { NeedsYouCountBlock } from "./NeedsYouCountBlock.jsx";
import { PriorityCard } from "./PriorityCard.jsx";

function NeedsYouBandInner({ snapshotLanes, liveDeadlines, liveBills, maxCards = 5, onOpenEmail, onMarkHandled, onCompleteDeadline, onOpen, onShowAll }) {
  const [opened, setOpened] = useState([]);
  const [handled, setHandled] = useState([]);
  const [expandAll, setExpandAll] = useState(false);
  const model = useMemo(
    () => buildNeedsYouModel({ snapshotLanes, liveDeadlines, liveBills, opened, handled, maxCards: expandAll ? Infinity : maxCards }),
    [snapshotLanes, liveDeadlines, liveBills, opened, handled, expandAll, maxCards],
  );

  const handleOpen = useCallback((card) => {
    setOpened((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
    if (card.uid) onOpenEmail?.(card.uid);
  }, [onOpenEmail]);

  const handleMarkHandled = useCallback((card) => {
    setHandled((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
    if (card.snapshotItemId != null) onMarkHandled?.(card.snapshotItemId);
  }, [onMarkHandled]);

  // Deadline "Mark done" → real Todoist completion (via the dashboard context's
  // canonical completer). Optimistically hide it here too so it leaves the band
  // instantly, before the completion round-trip flips its status.
  const handleComplete = useCallback((card) => {
    setHandled((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
    if (card.jumpId != null) onCompleteDeadline?.(card.jumpId, card.data);
  }, [onCompleteDeadline]);

  return (
    <div
      data-testid="needs-you-band"
      data-sect="needs-you"
      style={{ flex: "none", display: "flex", gap: 20, alignItems: "stretch", padding: "15px 18px", borderRadius: 16,
        background: "linear-gradient(180deg, color-mix(in srgb, var(--sp-rose) 5%, rgba(255,255,255,0.018)) 0%, rgba(255,255,255,0.005) 100%)",
        border: "1px solid color-mix(in srgb, var(--sp-rose) 15%, rgba(255,255,255,0.06))" }}
    >
      <NeedsYouCountBlock countN={model.countN} countColor={model.countColor} breakdown={model.breakdown} empty={model.countN === 0} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 10, alignItems: "stretch" }}>
        {model.urgentCards.map((card) => (
          <PriorityCard key={card.id} card={card} variant="urgent" onOpen={handleOpen} onMarkHandled={handleMarkHandled} onComplete={handleComplete} onJump={onOpen} />
        ))}
        {model.backfillCards.map((card) => (
          <PriorityCard key={card.id} card={card} variant="backfill" />
        ))}
        {model.moreCount > 0 && (
          <button
            type="button"
            onClick={() => { setExpandAll(true); onShowAll?.(); }}
            style={{ flex: "0 0 124px", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 4, padding: "13px 14px", borderRadius: 12, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; e.currentTarget.style.transform = "none"; }}
            onFocus={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
            onBlur={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
          >
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 30, fontWeight: 700, letterSpacing: "-1.5px", lineHeight: 1, color: "rgba(205,214,244,0.85)", fontVariantNumeric: "tabular-nums" }}>+{model.moreCount}</span>
            <span style={{ fontSize: 11, color: "rgba(205,214,244,0.55)", lineHeight: 1.3 }}>{model.moreLabel}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 11, fontWeight: 600, color: "var(--sp-accent)" }}>Show all<ArrowRight size={12} color="var(--sp-accent)" /></span>
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(NeedsYouBandInner);
