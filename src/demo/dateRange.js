export function demoDateRange(items, start, end, getDate) {
  const filtered = (items || []).filter((item) => {
    const key = getDate(item);
    return key >= start && key <= end;
  });
  return structuredClone(filtered);
}
