import { AnimatePresence } from "motion/react";
import CompletionTransition from "../CompletionTransition";
import { memo, useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import { buildNeedsYouModel, collectNeedsYouCandidateIds } from "./needsYouModel";
import { NeedsYouCountBlock } from "./NeedsYouCountBlock";
import { PriorityCard } from "./PriorityCard";
import { StartHereStrip } from "./StartHereStrip";
import { MobileNeedsYouList } from "./MobileNeedsYouList";
import type { NeedsYouBill, NeedsYouCard, NeedsYouDeadlines, NeedsYouLanes } from "./needsYouModel";

export interface NeedsYouBandProps {
  snapshotLanes?: NeedsYouLanes | null;
  liveDeadlines?: NeedsYouDeadlines;
  liveBills?: NeedsYouBill[] | null;
  railThreshold?: number;
  isMobile?: boolean;
  onOpenEmail?: (uid: string | number) => void;
  onMarkHandled?: (snapshotItemId: number) => Promise<unknown> | unknown;
  onCompleteDeadline?: (id: string | number, data: unknown) => Promise<unknown> | unknown;
  onOpen?: (payload: { kind?: string | null; id?: string | number | null; date?: string | null; data?: unknown }, anchor?: HTMLElement) => void;
  onPromotedDeadlineIdsChange?: (ids: readonly string[]) => void;
}

const ACTION_ERROR_TEXT = "Couldn't mark done — try again";

function NeedsYouBandInner({ snapshotLanes, liveDeadlines, liveBills, railThreshold = 5, isMobile = false, onOpenEmail, onMarkHandled, onCompleteDeadline, onOpen, onPromotedDeadlineIdsChange }: NeedsYouBandProps) {
  const [opened, setOpened] = useState<string[]>([]);
  const [handled, setHandled] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const desktopCardRowRef = useRef<HTMLDivElement | null>(null);
  const model = useMemo(
    () => buildNeedsYouModel({ snapshotLanes, liveDeadlines, liveBills, opened, handled, maxCards: Infinity, backfillLimit: 0 }),
    [snapshotLanes, liveDeadlines, liveBills, opened, handled],
  );
  const recommendation = model.urgentCards[0] ?? null;
  const queuedUrgentCards = recommendation ? model.urgentCards.slice(1) : model.urgentCards;
  const useDesktopRail = queuedUrgentCards.length + model.backfillCards.length > railThreshold;
  const promotedDeadlineIds = useMemo(
    () => model.urgentCards.flatMap((card) => (
      card.jumpKind === "deadline" && card.jumpId != null ? [String(card.jumpId)] : []
    )),
    [model.urgentCards],
  );

  useLayoutEffect(() => {
    onPromotedDeadlineIdsChange?.(promotedDeadlineIds);
  }, [onPromotedDeadlineIdsChange, promotedDeadlineIds]);

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

  const handleOpen = useCallback((card: NeedsYouCard) => {
    setOpened((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
    if (card.uid) onOpenEmail?.(card.uid);
  }, [onOpenEmail]);

  const handleStartHere = useCallback((card: NeedsYouCard, anchor: HTMLButtonElement) => {
    if (card.email) {
      handleOpen(card);
      return;
    }

    onOpen?.({ kind: card.jumpKind, id: card.jumpId, date: card.date, data: card.data }, anchor);
  }, [handleOpen, onOpen]);

  const handleMarkHandled = useCallback(async (card: NeedsYouCard) => {
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
  const handleComplete = useCallback(async (card: NeedsYouCard) => {
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

  useEffect(() => {
    const row = desktopCardRowRef.current;
    if (!row || isMobile || !useDesktopRail) return;

    const handleWheel = (event: globalThis.WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const maxScrollLeft = Math.max(0, row.scrollWidth - row.clientWidth);
      if (maxScrollLeft === 0) return;

      const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? row.clientWidth
          : 1;
      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, row.scrollLeft + (event.deltaY * deltaScale)));
      if (nextScrollLeft === row.scrollLeft) return;

      event.preventDefault();
      row.scrollLeft = nextScrollLeft;
    };

    row.addEventListener("wheel", handleWheel, { passive: false });
    return () => row.removeEventListener("wheel", handleWheel);
  }, [isMobile, useDesktopRail]);

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
      <MobileNeedsYouList
        handledIds={handled}
        urgentCards={model.urgentCards}
        countN={model.countN}
        countColor={model.countColor}
        breakdown={model.breakdown}
        actionError={actionError}
        onOpen={handleOpen}
        onMarkHandled={handleMarkHandled}
        onComplete={handleComplete}
        onJump={onOpen}
        recommendation={recommendation}
        onStartHere={handleStartHere}
      />
    );
  }

  return (
    <div
      data-testid="needs-you-band"
      style={{ flex: "none", display: "flex", gap: 20, alignItems: "stretch", padding: "18px 20px", borderRadius: 16,
        background: "var(--sp-card, rgba(36,36,58,0.4))",
        border: "1px solid var(--color-border, rgba(255,255,255,0.08))" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "none" }}>
        {header}
        {errorLine}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
        <AnimatePresence initial={false} custom={handled}>
          {recommendation && (
            <CompletionTransition key={recommendation.id} itemId={recommendation.id}>
            <StartHereStrip card={recommendation} onActivate={handleStartHere}
              onMarkHandled={handleMarkHandled} onComplete={handleComplete} />
            </CompletionTransition>
          )}
        </AnimatePresence>
        <div
          ref={desktopCardRowRef}
          data-testid="needs-you-card-row"
          style={{
            flex: 1, minWidth: 0, display: "flex", gap: 10, alignItems: "stretch",
            overflowX: useDesktopRail ? "auto" : "visible", overflowY: "visible",
            overscrollBehaviorX: "contain", scrollSnapType: "none",
            scrollbarColor: "color-mix(in srgb, var(--sp-accent) 32%, transparent) transparent",
            scrollbarWidth: useDesktopRail ? "thin" : "auto",
            padding: useDesktopRail ? "3px 1px 6px" : 0,
          }}
        >
          <AnimatePresence initial={false} custom={handled}>
            {queuedUrgentCards.map((card) => (
              <CompletionTransition key={card.id} itemId={card.id} horizontal style={{ display: "flex", minWidth: 0, flex: useDesktopRail ? "0 0 210px" : "1 1 0" }}>
                <PriorityCard card={card} variant="urgent" isMobile={isMobile} onOpen={handleOpen} onMarkHandled={handleMarkHandled} onComplete={handleComplete} onJump={onOpen} />
              </CompletionTransition>
            ))}
            {model.backfillCards.map((card) => (
              <CompletionTransition key={card.id} itemId={card.id} horizontal style={{ display: "flex", minWidth: 0, flex: useDesktopRail ? "0 0 210px" : "1 1 0" }}>
                <PriorityCard card={card} variant="backfill" isMobile={isMobile} onComplete={handleComplete} onJump={onOpen} />
              </CompletionTransition>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default memo(NeedsYouBandInner);
