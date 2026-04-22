import { useReducedMotion } from "motion/react";

const DETAIL_RAIL_LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 420,
  damping: 38,
  mass: 0.82,
  bounce: 0,
};

const DETAIL_RAIL_FADE_TRANSITION = {
  duration: 0.14,
  ease: [0.22, 1, 0.36, 1],
};

export function useDetailRailMotion() {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return {
      layout: { duration: 0.01 },
      fade: { duration: 0 },
    };
  }

  return {
    layout: DETAIL_RAIL_LAYOUT_TRANSITION,
    fade: DETAIL_RAIL_FADE_TRANSITION,
  };
}
