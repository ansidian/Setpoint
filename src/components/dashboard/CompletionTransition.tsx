import type { CSSProperties, ReactNode } from "react";
import { Check } from "lucide-react";
import { motion as Motion, useIsPresent, usePresenceData } from "motion/react";
import useMediaQuery from "../../hooks/useMediaQuery";
import { heightTransition } from "../../lib/motion";

/** Keep a visual receipt while the existing completion action proceeds immediately. */
export default function CompletionTransition({ children, itemId, completing: completingInPlace = false, horizontal = false, style }: {
  children: ReactNode;
  itemId: string;
  /** Show the same receipt for rows that remain visible after completion. */
  completing?: boolean;
  horizontal?: boolean;
  style?: CSSProperties;
}) {
  const present = useIsPresent();
  const completedIds = usePresenceData() as readonly string[] | undefined;
  const completing = completingInPlace || (!present && !!completedIds?.includes(itemId));
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const transition = heightTransition(reduced || !completing);

  return (
    <Motion.div
      initial={false}
      animate={{ opacity: 1, height: "auto", scale: 1 }}
      exit={{ opacity: 0, ...(horizontal ? { scale: 0.96 } : { height: 0 }), transition: { ...transition, delay: completing && !reduced ? 0.18 : 0 } }}
      inert={!present || completing || undefined}
      aria-hidden={!present || undefined}
      style={{ position: "relative", minWidth: 0, overflow: present ? "visible" : "clip", ...style }}
    >
      <Motion.div initial={false} animate={{ opacity: completing ? 0.25 : 1 }} transition={transition}
        style={horizontal ? { display: "flex", flex: 1, minWidth: 0, width: "100%" } : undefined}>
        {children}
      </Motion.div>
      {completing && <Motion.span
        initial={{ opacity: 0, scale: reduced ? 1 : 0.85 }} animate={{ opacity: 1, scale: 1 }}
        transition={transition} aria-hidden="true"
        style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, color: "var(--sp-green)", fontSize: 12, fontWeight: 650, pointerEvents: "none" }}
      ><Check size={16} />Done</Motion.span>}
    </Motion.div>
  );
}
