export function topmostVisibleDate(scrollTop, viewportTop, dateHeaderPositions) {
  const activeLine = scrollTop + viewportTop;
  let result = dateHeaderPositions[0].date;
  for (const { date, top } of dateHeaderPositions) {
    if (top <= activeLine) result = date;
    else break;
  }
  return result;
}

function monthKeyFromDate(ymd) {
  return ymd.slice(0, 7);
}

export function isNearBoundary(topmostDate, loadedMonths, threshold) {
  const key = monthKeyFromDate(topmostDate);
  const idx = loadedMonths.indexOf(key);
  if (idx === -1) return true;
  const fromStart = idx;
  const fromEnd = loadedMonths.length - 1 - idx;
  return fromStart < threshold || fromEnd < threshold;
}
