import { forwardRef, useEffect, useRef } from "react";

const NowMarker = forwardRef(function NowMarker(
  { time, top, textSpan, flagInset },
  ref,
) {
  const lineRef = useRef(null);

  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    if (!textSpan) {
      el.style.background =
        "linear-gradient(90deg, #cba6da 0%, transparent 100%)";
      el.style.maskImage = "";
      el.style.webkitMaskImage = "";
      return;
    }
    const w = el.offsetWidth;
    const { start, end } = textSpan;
    const clampedEnd = Math.min(end, w);
    const hasRoom = clampedEnd + 24 < w;
    const mask = hasRoom
      ? `linear-gradient(90deg, black 0px, black ${start}px, rgba(0,0,0,0.12) ${start + 8}px, rgba(0,0,0,0.12) ${clampedEnd}px, black ${clampedEnd + 16}px, black ${w - 40}px, transparent 100%)`
      : `linear-gradient(90deg, black 0px, black ${start}px, rgba(0,0,0,0.12) ${start + 8}px, rgba(0,0,0,0.12) ${w - 8}px, transparent 100%)`;
    el.style.background = "#cba6da";
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
  }, [textSpan]);

  return (
    <div
      ref={ref}
      className="absolute left-5 right-0 flex items-center gap-2 z-10 pointer-events-none"
      style={{ top, right: flagInset || undefined }}
    >
      <div
        ref={lineRef}
        className="flex-1 h-px"
        style={{
          background: "linear-gradient(90deg, #cba6da 0%, transparent 100%)",
        }}
      />
      <span className="text-[10px] max-sm:text-xs font-semibold tabular-nums text-[#cba6da] shrink-0 pointer-events-auto">
        {time}
      </span>
    </div>
  );
});

export default NowMarker;
