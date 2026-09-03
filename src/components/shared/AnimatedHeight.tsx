import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { motion as Motion, useReducedMotion } from "motion/react";
import { heightTransition } from "@/lib/motion";

/** For bounded content swaps whose children stay mounted (not live streams). */
export default function AnimatedHeight({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <Motion.div
      initial={false}
      animate={{ height: height ?? "auto" }}
      transition={heightTransition(reduce)}
      style={{ minWidth: 0, overflow: "hidden" }}
    >
      <div ref={contentRef} style={{ display: "flow-root" }}>{children}</div>
    </Motion.div>
  );
}
