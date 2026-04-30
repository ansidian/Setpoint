export default function CalendarSelectedCellFrame({
  children,
  selected = true,
  isEmpty = false,
  pastTone,
}) {
  const isPast = pastTone === "items" || pastTone === "empty";

  return (
    <div
      data-testid={selected ? "calendar-selected-cell-frame" : undefined}
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
