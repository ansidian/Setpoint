// walk up from el to find the nearest scrollable ancestor inside boundary
export function findScrollableParent(el, boundary) {
  let node = el;
  while (node && node !== boundary) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return boundary;
}

export function shouldDismissOnDragEnd(dragY, threshold = 100) {
  return dragY > threshold;
}

export function shouldEngageDrag(scrollEl) {
  return !scrollEl || scrollEl.scrollTop === 0;
}
