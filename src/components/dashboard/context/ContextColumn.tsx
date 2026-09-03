import { useMemo } from "react";
import WeatherCard from "./WeatherCard";
import ComingUpCard from "./ComingUpCard";
import InboxPeek from "../rails/InboxPeek";
import { buildComingUp } from "./comingUpModel";
import type { ActualBillOccurrence } from "../../../../shared/types/actual";
import type { DashboardWeather } from "./weatherCardModel";
import type { ComingUpRow } from "./comingUpModel";
import type { SnapshotItem } from "../../../../shared/types/snapshots";
import type { DashboardDeadline } from "../../../context/dashboardTaskProjection";

type ContextDeadline = DashboardDeadline;
type ContextBill = Partial<ActualBillOccurrence> & { id: string; next_date?: string };
type ContextRecord = ContextDeadline | ContextBill;
interface ContextColumnProps {
  liveWeather?: DashboardWeather | null;
  liveDeadlines?: { upcoming?: ContextDeadline[] } | ContextDeadline[] | null;
  liveBills?: ContextBill[] | null;
  snapshotLanes?: unknown;
  emailAccounts?: Array<{ important?: Array<Partial<SnapshotItem> & { id: string | number; date?: string | null }> }>;
  accent?: string;
  isMobile?: boolean;
  showInboxPeek?: boolean;
  onJump?: (payload: { kind?: string | null; id?: string | number | null; data?: unknown; date?: string | null; email?: unknown }, anchor?: HTMLElement) => void;
  onOpenInbox?: () => void;
  onCompleteDeadline?: (id: string, record: ContextDeadline) => unknown | Promise<unknown>;
}

export default function ContextColumn({
  liveWeather, liveDeadlines, liveBills, snapshotLanes: _snapshotLanes,
  emailAccounts = [], accent = "#cba6da", isMobile = false,
  showInboxPeek = true, onJump, onOpenInbox, onCompleteDeadline,
}: ContextColumnProps) {
  const comingUp = useMemo(() => buildComingUp({ liveDeadlines, liveBills, days: 7, includeToday: !isMobile }), [liveDeadlines, liveBills, isMobile]);

  const recordsById = useMemo(() => {
    const map = new Map<string, ContextRecord>();
    const deadlineList = Array.isArray(liveDeadlines) ? liveDeadlines : liveDeadlines?.upcoming || [];
    for (const d of deadlineList) map.set(`deadline:${d.id}`, d);
    for (const b of liveBills || []) map.set(`bill:${b.id}`, b);
    return map;
  }, [liveDeadlines, liveBills]);

  const handleComingUpJump = (row: ComingUpRow, anchor: HTMLElement) => {
    const record = recordsById.get(row.id);
    if (!record) return;
    if (row.kind === "deadline") onJump?.({ kind: "deadline", id: record.id, data: record }, anchor);
    else onJump?.({
      kind: "bill",
      id: record.id,
      data: record,
      date: "next_date" in record && typeof record.next_date === "string" ? record.next_date : null,
    }, anchor);
  };

  // Coming-up deadlines complete through the same canonical completer the band
  // uses: (taskId, record) → completeDeadlineOccurrence(id, due_date).
  const handleComingUpComplete = (row: ComingUpRow) => {
    const record = recordsById.get(row.id);
    if (!record) return;
    return onCompleteDeadline?.(record.id, record as ContextDeadline);
  };

  return (
    <div
      data-testid="dashboard-context-column"
      style={{
        display: "flex", flexDirection: "column", gap: 13, minHeight: 0, height: "100%",
        overflowX: "hidden", overflowY: "auto", overscrollBehavior: "contain",
      }}
    >
      <WeatherCard weather={liveWeather} />
      <ComingUpCard items={comingUp} isMobile={isMobile} onJump={handleComingUpJump} onComplete={onCompleteDeadline ? handleComingUpComplete : undefined} />
      {showInboxPeek && (
        <InboxPeek accent={accent} emailAccounts={emailAccounts} onJump={onJump} onOpenInbox={onOpenInbox} isMobile={isMobile} />
      )}
    </div>
  );
}
