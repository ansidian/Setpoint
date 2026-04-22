import { AnimatePresence, motion as Motion } from "motion/react";

const railSwapLayoutTransition = {
  type: "spring",
  stiffness: 340,
  damping: 34,
  mass: 0.9,
  bounce: 0,
};

const railSwapFadeTransition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1],
};

export default function AnimatedRailContent({ contentKey, contentKind, children }) {
  const shouldLift = contentKind === "detail" || contentKind === "empty";

  return (
    <Motion.div
      layout
      transition={railSwapLayoutTransition}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <Motion.div
          key={contentKey}
          data-testid="calendar-rail-content"
          data-rail-content-kind={contentKind}
          layout
          initial={{
            opacity: 0,
            y: shouldLift ? 6 : 4,
            scale: shouldLift ? 0.992 : 0.996,
          }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
          }}
          exit={{
            opacity: 0,
            y: shouldLift ? -4 : -2,
            scale: 0.996,
          }}
          transition={{
            layout: railSwapLayoutTransition,
            opacity: railSwapFadeTransition,
            y: railSwapFadeTransition,
            scale: railSwapFadeTransition,
          }}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            transformOrigin: "top center",
            willChange: "opacity, transform",
          }}
        >
          {children}
        </Motion.div>
      </AnimatePresence>
    </Motion.div>
  );
}
