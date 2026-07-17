import { AnimatePresence, motion as Motion, useReducedMotion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { getRailSwapMotion } from "../detailRailMotion";

export interface AnimatedRailContentProps {
  contentKey: string;
  contentKind: string;
  layoutTier: string;
  children: ReactNode;
}

export default function AnimatedRailContent({ contentKey, contentKind, layoutTier, children }: AnimatedRailContentProps) {
  const reducedMotion = useReducedMotion();
  const railMotion = getRailSwapMotion(layoutTier, !!reducedMotion);
  const positionTransition = railMotion.position as ComponentProps<typeof Motion.div>["transition"];
  const shouldLift = contentKind === "detail" || contentKind === "empty";
  const contentStyle = {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  } as const;

  if (contentKind === "editor") {
    return (
      <Motion.div
        layout="position"
        transition={positionTransition}
        style={contentStyle}
      >
        <div
          key={contentKey}
          data-testid="calendar-rail-content"
          data-rail-content-kind={contentKind}
          data-rail-motion="editor"
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
      transition={positionTransition}
      style={contentStyle}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <Motion.div
          key={contentKey}
          data-testid="calendar-rail-content"
          data-rail-content-kind={contentKind}
          data-rail-motion="standard"
          initial={{
            opacity: 0,
            y: shouldLift ? railMotion.liftY : railMotion.settleY,
            scale: shouldLift ? 0.986 : 0.992,
          }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
          }}
          exit={{
            opacity: 0,
            y: shouldLift ? -Math.max(6, railMotion.liftY - 2) : -4,
            scale: 0.992,
          }}
          transition={{
            opacity: railMotion.fade,
            y: railMotion.fade,
            scale: railMotion.fade,
          } as ComponentProps<typeof Motion.div>["transition"]}
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
