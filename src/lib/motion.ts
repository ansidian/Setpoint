export const motionEaseOut = [0.16, 1, 0.3, 1] as const;

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
