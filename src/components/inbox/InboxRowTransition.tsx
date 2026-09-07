import { useEffect, type ReactNode } from "react";
import { motion as Motion, usePresence, useReducedMotion } from "motion/react";
import { heightMotionEase } from "../../lib/motion";

/** Open and close row space together; departing mail is immediately inert. */
export default function InboxRowTransition({ children }: { children: ReactNode }) {
  const [present, safeToRemove] = usePresence();
  const reduceMotion = useReducedMotion() ?? false;
  const exitMs = reduceMotion ? 0 : 180;

  // Activity tears down effects while Inbox is hidden. Motion's automatic exit
  // can miss that restart, leaving the departed row visible and inert forever.
  // Own the removal deadline so it also resumes after a tab switch mid-exit.
  useEffect(() => {
    if (present || !safeToRemove) return;
    const timer = window.setTimeout(safeToRemove, exitMs);
    return () => window.clearTimeout(timer);
  }, [present, safeToRemove, exitMs]);

  return (
    <Motion.div
      initial={reduceMotion ? false : { height: 0, opacity: 0 }}
      animate={present ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
      transition={{
        height: { duration: exitMs / 1000, ease: heightMotionEase },
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
