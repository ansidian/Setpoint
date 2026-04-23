import { AnimatePresence, motion as Motion } from "motion/react";

const railSwapPositionTransition = {
  type: "spring",
  stiffness: 300,
  damping: 32,
  mass: 0.95,
  bounce: 0,
};

const railSwapFadeTransition = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1],
};

export default function AnimatedRailContent({ contentKey, contentKind, children }) {
  const shouldLift = contentKind === "detail" || contentKind === "empty";
  const instantSwap = contentKind === "editor";
  const contentStyle = {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  };

  if (instantSwap) {
    return (
      <Motion.div
        layout="position"
        transition={railSwapPositionTransition}
        style={contentStyle}
      >
        <div
          key={contentKey}
          data-testid="calendar-rail-content"
          data-rail-content-kind={contentKind}
          style={contentStyle}
        >
          {children}
        </div>
      </Motion.div>
    );
  }

  return (
    <Motion.div
      layout="position"
      transition={railSwapPositionTransition}
      style={contentStyle}
    >
      <AnimatePresence initial={false} mode="sync">
        <Motion.div
          key={contentKey}
          data-testid="calendar-rail-content"
          data-rail-content-kind={contentKind}
          initial={{
            opacity: 0,
            y: shouldLift ? 10 : 6,
            scale: shouldLift ? 0.986 : 0.992,
          }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
          }}
          exit={{
            opacity: 0,
            y: shouldLift ? -8 : -4,
            scale: 0.992,
          }}
          transition={{
            opacity: railSwapFadeTransition,
            y: railSwapFadeTransition,
            scale: railSwapFadeTransition,
          }}
          style={{
            ...contentStyle,
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
