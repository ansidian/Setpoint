export const motionEaseOut = [0.16, 1, 0.3, 1] as const;

// CSS `ease`, matching the event notes field's compact collapse.
export const heightMotionDuration = 0.16;
export const heightMotionMaxDuration = 0.25;
export const heightMotionEase = [0.25, 0.1, 0.25, 1] as const;

export function heightTransition(reduce: boolean | null) {
  return { duration: reduce ? 0 : heightMotionDuration, ease: heightMotionEase };
}

/** A resize burst gets one deadline, including reversals and moving targets.
 * Following a child stays immediate through its final measurement. */
export function createHeightMotionBudget() {
  let started = -Infinity;
  let previous = -Infinity;
  let following = false;
  return (now: number, childAnimating = false) => {
    if (now - previous > heightMotionDuration * 1000) {
      started = now;
      following = false;
    }
    previous = now;
    following ||= childAnimating;
    return following ? 0 : Math.max(0, Math.min(heightMotionDuration, heightMotionMaxDuration - (now - started) / 1000));
  };
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
