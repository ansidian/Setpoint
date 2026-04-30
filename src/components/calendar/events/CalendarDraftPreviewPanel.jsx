import { ghostDisplayRange } from "../ghostPreview.js";

export default function CalendarDraftPreviewPanel({ ghostPreview }) {
  const ghosts = ghostPreview?.ghosts || [];
  if (!ghosts.length) return null;
  const first = ghosts[0];
  const conflictCount = ghostPreview.totalConflictCount || 0;
  const summary = ghosts.length > 1
    ? `${ghosts.length} draft events`
    : ghostDisplayRange(first);

  return (
    <div
      data-testid="calendar-draft-preview-summary"
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: conflictCount
          ? "1px solid rgba(243,139,168,0.26)"
          : "1px solid rgba(137,180,250,0.18)",
        background: conflictCount ? "rgba(243,139,168,0.08)" : "rgba(137,180,250,0.07)",
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: conflictCount ? "#f38ba8" : "#89b4fa" }}>
        Draft preview
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "rgba(205,214,244,0.78)" }}>
        {summary}
      </div>
      {conflictCount ? (
        <div style={{ fontSize: 11, lineHeight: 1.4, color: "#f5c2e7" }}>
          Overlaps {conflictCount} event{conflictCount === 1 ? "" : "s"}.
        </div>
      ) : first.recurring ? (
        <div style={{ fontSize: 11, lineHeight: 1.4, color: "rgba(205,214,244,0.58)" }}>
          Showing the first occurrence.
        </div>
      ) : null}
    </div>
  );
}
