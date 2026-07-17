export function demoDateRange<T>(items: T[] | null | undefined, start: string, end: string, getDate: (item: T) => string): T[] {
  const filtered = (items || []).filter((item) => {
    const key = getDate(item);
    return key >= start && key <= end;
  });
  return structuredClone(filtered);
}
