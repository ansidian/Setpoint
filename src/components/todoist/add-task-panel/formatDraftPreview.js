function formatFriendlyPreviewTime(value) {
  const text = String(value || "").trim();
  if (!text) return "End of day";
  return text.replace(/:00\s+(AM|PM)$/i, " $1");
}

export function formatFriendlyDraftPreview(draftPreview) {
  if (!draftPreview?.dueDate) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(draftPreview.dueDate));
  const dateLabel = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : draftPreview.dueDate;
  return `${dateLabel} · ${formatFriendlyPreviewTime(draftPreview.dueTime)}`;
}
