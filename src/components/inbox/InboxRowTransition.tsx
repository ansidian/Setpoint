import type { ReactNode } from "react";
import { motion as Motion, useIsPresent } from "motion/react";
import useMediaQuery from "../../hooks/useMediaQuery";
import { heightTransition, motionDuration } from "../../lib/motion";

/** Keep departing mail visible, but noninteractive, until its space closes. */
export default function InboxRowTransition({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const departure = reduceMotion ? 0 : motionDuration.feedback;
  return (
    <Motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0, transition: { ...heightTransition(reduceMotion), delay: departure } }}
      transition={heightTransition(reduceMotion)}
      aria-hidden={!present || undefined}
      inert={!present || undefined}
      style={{ overflow: "clip", minHeight: 0 }}
    >
      <Motion.div
        initial={{ x: 0, opacity: 1 }}
        animate={{ x: present || reduceMotion ? 0 : 12, opacity: present ? 1 : 0 }}
        transition={{ duration: departure }}
      >
        {children}
      </Motion.div>
    </Motion.div>
  );
}
