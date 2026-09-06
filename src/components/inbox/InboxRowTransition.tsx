import type { ReactNode } from "react";
import { motion as Motion, useIsPresent, useReducedMotion } from "motion/react";
import { heightMotionEase } from "../../lib/motion";

/** Open and close row space together; departing mail is immediately inert. */
export default function InboxRowTransition({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <Motion.div
      initial={reduceMotion ? false : { height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        height: { duration: reduceMotion ? 0 : 0.18, ease: heightMotionEase },
        opacity: { duration: reduceMotion ? 0 : present ? 0.14 : 0.1, ease: "easeOut" },
      }}
      aria-hidden={!present || undefined}
      inert={!present || undefined}
      style={{ overflow: "clip", minHeight: 0 }}
    >
      {children}
    </Motion.div>
  );
}
