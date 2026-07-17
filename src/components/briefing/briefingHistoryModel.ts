const TZ = "America/Los_Angeles";
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

interface SnapshotDateItem {
  start_at?: string | null;
  created_at?: string | null;
}

interface SnapshotCountItem extends SnapshotDateItem {
  end_at?: string | null;
  item_count?: number | null;
  laneCounts?: object | null;
}

export interface SnapshotDateGroup<T extends SnapshotDateItem> {
  label: string;
  items: Array<T & { _date: Date }>;
}

function parseSnapshotDate(item: SnapshotDateItem): Date {
  return new Date(item.start_at || item.created_at || Date.now());
}

export function groupByDate<T extends SnapshotDateItem>(items: T[]): SnapshotDateGroup<T>[] {
  const groups: SnapshotDateGroup<T>[] = [];
  const todayStr = dateFmt.format(new Date());
  const yesterdayStr = dateFmt.format(new Date(Date.now() - 86400000));

  let currentLabel: string | null = null;
  let currentItems: Array<T & { _date: Date }> = [];

  for (const item of items) {
    const d = parseSnapshotDate(item);
    const itemDateStr = dateFmt.format(d);

    let label: string;
    if (itemDateStr === todayStr) label = "Today";
    else if (itemDateStr === yesterdayStr) label = "Yesterday";
    else label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });

    if (label !== currentLabel) {
      if (currentLabel !== null) groups.push({ label: currentLabel, items: currentItems });
      currentLabel = label;
      currentItems = [];
    }
    currentItems.push({ ...item, _date: d });
  }
  if (currentLabel !== null) groups.push({ label: currentLabel, items: currentItems });

  return groups;
}

export function formatWindow(item: SnapshotCountItem): string {
  const start = parseSnapshotDate(item);
  const end = item.end_at ? new Date(item.end_at) : null;
  const startLabel = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
  if (!end) return startLabel;
  const endLabel = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
  return `${startLabel} to ${endLabel}`;
}

export function countLabel(item: SnapshotCountItem): string {
  const counts = item.laneCounts || {};
  const total = Number(item.item_count ?? Object.values(counts).reduce<number>((sum, count) => sum + Number(count || 0), 0));
  if (total === 0) return "No visible mail";
  return `${total} item${total === 1 ? "" : "s"}`;
}
