import { useReducedMotion } from "motion/react";

export const EDITOR_ENTRANCE_TRANSITION = {
  duration: 0.3,
  ease: [0.22, 1, 0.36, 1],
};

export const EDITOR_POSITION_TRANSITION = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1],
};

const DETAIL_RAIL_LAYOUT_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
};

const DETAIL_RAIL_FADE_TRANSITION = {
  duration: 0.14,
  ease: [0.22, 1, 0.36, 1],
};

const XL_DETAIL_RAIL_LAYOUT_TRANSITION = {
  duration: 0.14,
  ease: [0.16, 1, 0.3, 1],
};

const RAIL_SWAP_POSITION_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
};

const XL_RAIL_SWAP_POSITION_TRANSITION = {
  duration: 0.14,
  ease: [0.16, 1, 0.3, 1],
};

const RAIL_SWAP_FADE_TRANSITION = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1],
};

const XL_RAIL_SWAP_FADE_TRANSITION = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1],
};

function resolveTier(layoutTier) {
  if (layoutTier) return layoutTier;
  if (typeof window !== "undefined" && window.innerWidth >= 1800) return "xl";
  return "default";
}

export function getRailSwapMotion(layoutTier, reducedMotion = false) {
  if (reducedMotion) {
    return {
      position: { duration: 0.01 },
      fade: { duration: 0 },
      liftY: 0,
      settleY: 0,
    };
  }

  const tier = resolveTier(layoutTier);
  return {
    position: tier === "xl" ? XL_RAIL_SWAP_POSITION_TRANSITION : RAIL_SWAP_POSITION_TRANSITION,
    fade: tier === "xl" ? XL_RAIL_SWAP_FADE_TRANSITION : RAIL_SWAP_FADE_TRANSITION,
    liftY: tier === "xl" ? 10 : 10,
    settleY: tier === "xl" ? 6 : 6,
  };
}

export function useDetailRailMotion(layoutTier) {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return {
      layout: { duration: 0.01 },
      fade: { duration: 0 },
    };
  }

  const tier = resolveTier(layoutTier);
  return {
    layout: tier === "xl" ? XL_DETAIL_RAIL_LAYOUT_TRANSITION : DETAIL_RAIL_LAYOUT_TRANSITION,
    fade: DETAIL_RAIL_FADE_TRANSITION,
  };
}
