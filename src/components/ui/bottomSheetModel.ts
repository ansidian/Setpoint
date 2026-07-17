// walk up from el to find the nearest scrollable ancestor inside boundary
export function findScrollableParent(el: EventTarget | null, boundary: HTMLElement | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return boundary;
  let node: HTMLElement | null = el;
  while (node && node !== boundary) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return boundary;
}

export function shouldDismissOnDragEnd(dragY: number | null, threshold = 100): boolean {
  if (dragY === null) return false;
  return dragY > threshold;
}

export function shouldEngageDrag(scrollEl: Pick<HTMLElement, "scrollTop"> | null): boolean {
  return !scrollEl || scrollEl.scrollTop === 0;
}
