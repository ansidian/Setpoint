export default function CalendarSelectedCellFrame({
  children,
  isEmpty = false,
  pastTone,
}) {
  const isPast = pastTone === "items" || pastTone === "empty";

  return (
    <div
      data-testid="calendar-selected-cell-frame"
      style={{
        position: "relative",
        minHeight: isEmpty ? 0 : "100%",
        minWidth: 0,
        opacity: isPast ? 0.92 : 1,
        transition: "opacity 150ms",
      }}
    >
      {children}
    </div>
  );
}
