import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { animate, motion as Motion, useMotionValue, useReducedMotion } from "motion/react";
import { createHeightMotionBudget, heightMotionDuration, heightMotionEase } from "@/lib/motion";

function hasAnimatingHeight(content: HTMLElement) {
  if (content.querySelector('[data-height-animating="true"]')) return true;
  // Include CSS-driven height changes such as expanding textareas.
  return content.getAnimations?.({ subtree: true }).some((animation) =>
    animation.playState === "running" && animation.effect instanceof KeyframeEffect &&
    animation.effect.getKeyframes().some((frame) =>
      ["height", "minHeight", "maxHeight", "gridTemplateRows"].some((property) => property in frame)),
  ) ?? false;
}

/** For bounded content swaps whose children stay mounted (not live streams). */
export default function AnimatedHeight({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number | "auto">("auto");
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const content = contentRef.current;
    const shell = shellRef.current;
    if (!content || !shell) return;
    const budget = createHeightMotionBudget();
    let nativeDisclosureUntil = -Infinity;
    const onToggle = (event: Event) => {
      // Chromium can animate ::details-content without exposing an Animation
      // or transition events. Native toggle identifies its shared 160ms motion.
      if (event.target instanceof HTMLDetailsElement) nativeDisclosureUntil = performance.now() + heightMotionDuration * 1000;
    };
    content.addEventListener("toggle", onToggle, true);
    const clearAnimating = () => { delete shell.dataset.heightAnimating; };
    // Keep natural initial sizing; ResizeObserver measures without ancestor
    // transforms (for example the dialog's entering scale).
    height.jump("auto");
    let previousHeight: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.height === previousHeight) return;
      const nextHeight = entry.contentRect.height;
      const initial = previousHeight === undefined;
      previousHeight = nextHeight;
      const now = performance.now();
      const duration = initial || reduce ? 0 : budget(now, now <= nativeDisclosureUntil || hasAnimatingHeight(content));
      height.stop();
      clearAnimating();
      if (!duration) {
        // A child owns this movement. Following it directly avoids easing each
        // intermediate frame again. DOM ancestry keeps portals independent.
        height.jump(nextHeight);
      } else {
        shell.dataset.heightAnimating = "true";
        animate(height, nextHeight, { duration, ease: heightMotionEase, onComplete: clearAnimating });
      }
    });
    observer.observe(content);
    return () => { observer.disconnect(); content.removeEventListener("toggle", onToggle, true); height.stop(); clearAnimating(); };
  }, [height, reduce]);

  return (
    <Motion.div
      ref={shellRef}
      className="sp-animated-height"
      style={{ height, minWidth: 0 }}
    >
      <div ref={contentRef} style={{ display: "flow-root" }}>{children}</div>
    </Motion.div>
  );
}
