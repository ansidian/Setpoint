import { useMemo } from "react";
import WeatherCard from "./WeatherCard.jsx";
import ComingUpCard from "./ComingUpCard.jsx";
import InboxPeek from "../rails/InboxPeek.jsx";
import { buildComingUp } from "./comingUpModel.js";

export default function ContextColumn({
  liveWeather, liveDeadlines, liveBills, snapshotLanes: _snapshotLanes,
  emailAccounts = [], accent = "#cba6da", isMobile = false,
  showInboxPeek = true, onJump, onOpenInbox, onCompleteDeadline,
}) {
  const comingUp = useMemo(() => buildComingUp({ liveDeadlines, liveBills, days: 7 }), [liveDeadlines, liveBills]);

  const recordsById = useMemo(() => {
    const map = new Map();
    const deadlineList = Array.isArray(liveDeadlines) ? liveDeadlines : liveDeadlines?.upcoming || [];
    for (const d of deadlineList) map.set(`deadline:${d.id}`, d);
    for (const b of liveBills || []) map.set(`bill:${b.id}`, b);
    return map;
  }, [liveDeadlines, liveBills]);

  const handleComingUpJump = (row) => {
    const record = recordsById.get(row.id);
    if (!record) return;
    if (row.kind === "deadline") onJump?.({ kind: "deadline", id: record.id, data: record });
    else onJump?.({ kind: "bill", id: record.id, data: record, date: record.next_date || null });
  };

  // Coming-up deadlines complete through the same canonical completer the band
  // uses: (taskId, record) → completeDeadlineOccurrence(id, due_date).
  const handleComingUpComplete = (row) => {
    const record = recordsById.get(row.id);
    if (!record) return;
    onCompleteDeadline?.(record.id, record);
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
