import { memo, useMemo, useState, useCallback, useEffect } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { buildNeedsYouModel, collectNeedsYouCandidateIds } from "./needsYouModel.js";
import { NeedsYouCountBlock } from "./NeedsYouCountBlock.jsx";
import { PriorityCard } from "./PriorityCard.jsx";
import { NeedsYouCarousel } from "./NeedsYouCarousel.jsx";

const ACTION_ERROR_TEXT = "Couldn't mark done — try again";

function NeedsYouBandInner({ snapshotLanes, liveDeadlines, liveBills, maxCards = 5, isMobile = false, onOpenEmail, onMarkHandled, onCompleteDeadline, onOpen, onShowAll }) {
  const [opened, setOpened] = useState([]);
  const [handled, setHandled] = useState([]);
  const [expandAll, setExpandAll] = useState(false);
  const [actionError, setActionError] = useState(null);
  const model = useMemo(
    () => buildNeedsYouModel({ snapshotLanes, liveDeadlines, liveBills, opened, handled, maxCards: expandAll ? Infinity : maxCards }),
    [snapshotLanes, liveDeadlines, liveBills, opened, handled, expandAll, maxCards],
  );

  // Stale-id pruning (ARCH-06): `opened`/`handled` only ever grow via the
  // handlers below, so a re-surfaced item (server sends the same id again
  // after re-adding it) would otherwise stay permanently suppressed. Once the
  // server view no longer contains an id, it's safe to drop from both arrays.
  // An id still present in server data is NOT pruned — that also covers the
  // in-flight optimistic-hide case, since the server hasn't caught up yet.
  useEffect(() => {
    const candidateIds = collectNeedsYouCandidateIds({ snapshotLanes, liveDeadlines, liveBills });
    setHandled((prev) => {
      const next = prev.filter((id) => candidateIds.has(id));
      return next.length === prev.length ? prev : next;
    });
    setOpened((prev) => {
      const next = prev.filter((id) => candidateIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [snapshotLanes, liveDeadlines, liveBills]);

  const handleOpen = useCallback((card) => {
    setOpened((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
    if (card.uid) onOpenEmail?.(card.uid);
  }, [onOpenEmail]);

  const handleMarkHandled = useCallback(async (card) => {
    setHandled((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
    if (card.snapshotItemId == null) return;
    try {
      const result = await onMarkHandled?.(card.snapshotItemId);
      if (result === false) throw new Error("mark handled failed");
      setActionError(null);
    } catch {
      setHandled((prev) => prev.filter((id) => id !== card.id));
      setActionError(ACTION_ERROR_TEXT);
    }
  }, [onMarkHandled]);

  // Deadline "Mark done" → real Todoist completion (via the dashboard context's
  // canonical completer). Optimistically hide it here too so it leaves the band
  // instantly, before the completion round-trip flips its status. On rejection
  // or a resolved `false` (server-reported failure), revert the hide and
  // surface an inline error instead of leaving the card silently gone.
  const handleComplete = useCallback(async (card) => {
    setHandled((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
    if (card.jumpId == null) return;
    try {
      const result = await onCompleteDeadline?.(card.jumpId, card.data);
      if (result === false) throw new Error("complete failed");
      setActionError(null);
    } catch {
      setHandled((prev) => prev.filter((id) => id !== card.id));
      setActionError(ACTION_ERROR_TEXT);
    }
  }, [onCompleteDeadline]);

  const allClear = model.countN === 0;

  const allClearBlock = (
    <div style={!isMobile
      ? { width: 190, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, paddingRight: 18, borderRight: "1px solid rgba(255,255,255,0.07)" }
      : { width: "100%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
      <CheckCircle2 size={18} color="var(--sp-green)" />
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--sp-green)" }}>All clear</span>
    </div>
  );
  const header = allClear
    ? allClearBlock
    : <NeedsYouCountBlock countN={model.countN} countColor={model.countColor} breakdown={model.breakdown} isMobile={isMobile} />;

  const errorLine = actionError ? (
    <div style={{ fontSize: 11, color: "var(--sp-rose)", lineHeight: 1.3 }}>{actionError}</div>
  ) : null;

  if (isMobile) {
    return (
      <div
        data-testid="needs-you-band"
        data-sect="needs-you"
        style={{ flex: "none", display: "flex", flexDirection: "column", gap: 12, padding: "14px 14px", borderRadius: 16,
          background: "linear-gradient(180deg, color-mix(in srgb, var(--sp-rose) 5%, rgba(255,255,255,0.018)) 0%, rgba(255,255,255,0.005) 100%)",
          border: "1px solid color-mix(in srgb, var(--sp-rose) 15%, rgba(255,255,255,0.06))" }}
      >
        {header}
        {errorLine}
        <NeedsYouCarousel
          urgentCards={model.urgentCards}
          backfillCards={model.backfillCards}
          moreCount={model.moreCount}
          moreLabel={model.moreLabel}
          expanded={expandAll}
          onShowAll={() => { setExpandAll(true); onShowAll?.(); }}
          onCollapse={() => setExpandAll(false)}
          onOpen={handleOpen}
          onMarkHandled={handleMarkHandled}
          onComplete={handleComplete}
          onJump={onOpen}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="needs-you-band"
      data-sect="needs-you"
      style={{ flex: "none", display: "flex", gap: 20, alignItems: "stretch", padding: "15px 18px", borderRadius: 16,
        background: "linear-gradient(180deg, color-mix(in srgb, var(--sp-rose) 5%, rgba(255,255,255,0.018)) 0%, rgba(255,255,255,0.005) 100%)",
        border: "1px solid color-mix(in srgb, var(--sp-rose) 15%, rgba(255,255,255,0.06))" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "none" }}>
        {header}
        {errorLine}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 10, alignItems: "stretch" }}>
        {model.urgentCards.map((card) => (
          <PriorityCard key={card.id} card={card} variant="urgent" isMobile={isMobile} onOpen={handleOpen} onMarkHandled={handleMarkHandled} onComplete={handleComplete} onJump={onOpen} />
        ))}
        {model.backfillCards.map((card) => (
          <PriorityCard key={card.id} card={card} variant="backfill" isMobile={isMobile} onComplete={handleComplete} onJump={onOpen} />
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
        {expandAll && (
          <button
            type="button"
            onClick={() => setExpandAll(false)}
            style={{ flex: "0 0 124px", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 4, padding: "13px 14px", borderRadius: 12, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; e.currentTarget.style.transform = "none"; }}
            onFocus={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
            onBlur={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--sp-accent)" }}>Show less<ArrowRight size={12} color="var(--sp-accent)" style={{ transform: "rotate(180deg)" }} /></span>
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(NeedsYouBandInner);
