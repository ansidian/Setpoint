import type { ReactNode } from "react";
import { motion as Motion, useIsPresent, useReducedMotion } from "motion/react";
import { heightTransition } from "../../lib/motion";

/** Keep departing mail visible, but noninteractive, until its space closes. */
export default function InboxRowTransition({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();
  return (
    <Motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={heightTransition(reduceMotion)}
      aria-hidden={!present || undefined}
      inert={!present || undefined}
      style={{ overflow: "clip", minHeight: 0 }}
    >
      {children}
    </Motion.div>
  );
}
