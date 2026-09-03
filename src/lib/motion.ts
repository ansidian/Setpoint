export const motionEaseOut = [0.16, 1, 0.3, 1] as const;

// CSS `ease`, matching the event notes field's compact collapse.
export const heightMotionDuration = 0.16;
export const heightMotionEase = [0.25, 0.1, 0.25, 1] as const;

export function heightTransition(reduce: boolean | null) {
  return { duration: reduce ? 0 : heightMotionDuration, ease: heightMotionEase };
}

export const motionDuration = {
  feedback: 0.15,
  exit: 0.26,
  panel: 0.36,
} as const;

export function motionTransition(reduce: boolean, duration: number = motionDuration.panel) {
  return reduce
    ? { duration: 0 }
    : { duration, ease: motionEaseOut };
}
