// Ref-counted scroll lock shared by every overlay that needs to freeze
// background scrolling (BottomSheet, the AddTaskPanel mobile placement, etc).
// A single module-level counter means nested opens/closes can never strand a
// permanent lock or unlock the page out from under a still-open overlay,
// regardless of teardown order.
let refCount = 0;
let savedOverflow = null;

function collectTargets() {
  return [
    document.body,
    document.documentElement,
    ...document.querySelectorAll("[data-scroll-lock-target]"),
  ];
}

export function acquireScrollLock() {
  refCount += 1;
  if (refCount === 1) {
    savedOverflow = new Map();
    for (const el of collectTargets()) {
      savedOverflow.set(el, el.style.overflow);
      el.style.overflow = "hidden";
    }
  }

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && savedOverflow) {
      for (const [el, prevOverflow] of savedOverflow) {
        el.style.overflow = prevOverflow;
      }
      savedOverflow = null;
    }
  };
}
