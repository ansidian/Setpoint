import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { PriorityCard } from "./PriorityCard.jsx";

const SLIDE = { flex: "0 0 min(82vw, 300px)", scrollSnapAlign: "start", display: "flex" };

// Mobile-only: the needs-you cards as a horizontal scroll-snap carousel. Each
// card is a fixed-width snap slide with the next card peeking (~15%) as the swipe
// affordance; position dots track the active slide; "Show all" is the last slide.
// touch-action: pan-x pan-y allows both horizontal carousel swipes and vertical page scrolls, with the browser disambiguating by initial gesture direction.
export function NeedsYouCarousel({ urgentCards, backfillCards, moreCount, moreLabel, expanded = false, onShowAll, onCollapse, onOpen, onMarkHandled, onComplete, onJump }) {
  const scrollerRef = useRef(null);
  const [active, setActive] = useState(0);
  const slideCount = urgentCards.length + backfillCards.length + (moreCount > 0 || expanded ? 1 : 0);

  const handleScroll = () => {
    const el = scrollerRef.current;
    const first = el?.firstChild;
    if (!first) return;
    const step = first.getBoundingClientRect().width + 10; // slide width + gap
    const raw = step > 0 ? Math.round(el.scrollLeft / step) : 0;
    setActive(Math.max(0, Math.min(slideCount - 1, raw)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        data-testid="needs-you-carousel"
        style={{
          display: "flex", gap: 10, overflowX: "auto",
          scrollSnapType: "x mandatory", touchAction: "pan-x pan-y",
          overscrollBehaviorX: "contain", scrollbarWidth: "none",
        }}
      >
        {urgentCards.map((card) => (
          <div key={card.id} style={SLIDE}>
            <PriorityCard card={card} variant="urgent" isMobile onOpen={onOpen} onMarkHandled={onMarkHandled} onComplete={onComplete} onJump={onJump} />
          </div>
        ))}
        {backfillCards.map((card) => (
          <div key={card.id} style={SLIDE}>
            <PriorityCard card={card} variant="backfill" isMobile onComplete={onComplete} onJump={onJump} />
          </div>
        ))}
        {moreCount > 0 && (
          <div style={SLIDE}>
            <button
              type="button"
              onClick={onShowAll}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 4, padding: "13px 14px", borderRadius: 12, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit", minHeight: "var(--sp-touch-min)" }}
            >
              <span style={{ fontFamily: "var(--font-sans)", fontSize: 30, fontWeight: 700, letterSpacing: "-1.5px", lineHeight: 1, color: "rgba(205,214,244,0.85)", fontVariantNumeric: "tabular-nums" }}>+{moreCount}</span>
              <span style={{ fontSize: 11, color: "rgba(205,214,244,0.55)", lineHeight: 1.3 }}>{moreLabel}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 11, fontWeight: 600, color: "var(--sp-accent)" }}>Show all<ArrowRight size={12} color="var(--sp-accent)" /></span>
            </button>
          </div>
        )}
        {expanded && (
          <div style={SLIDE}>
            <button
              type="button"
              onClick={onCollapse}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 4, padding: "13px 14px", borderRadius: 12, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit", minHeight: "var(--sp-touch-min)" }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--sp-accent)" }}>Show less<ArrowRight size={12} color="var(--sp-accent)" style={{ transform: "rotate(180deg)" }} /></span>
            </button>
          </div>
        )}
      </div>
      {slideCount > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
          {Array.from({ length: slideCount }).map((_, i) => (
            <span key={i} aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: i === active ? "var(--sp-accent)" : "rgba(255,255,255,0.22)", transition: "background 150ms" }} />
          ))}
          <span role="status" aria-live="polite" className="sr-only">
            {`Card ${active + 1} of ${slideCount}`}
          </span>
        </div>
      )}
    </div>
  );
}
