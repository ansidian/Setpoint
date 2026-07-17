import { DAYS } from "./calendarGridUtils";

export default function CalendarGridWeekHeader({ gap }: { gap: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap,
        marginBottom: 8,
        flexShrink: 0,
      }}
    >
      {DAYS.map((day) => (
        <div
          key={day}
          role="columnheader"
          style={{
            textAlign: "center",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--color-text-faint)",
            padding: 4,
            letterSpacing: 1.6,
            textTransform: "uppercase",
          }}
        >
          {day}
        </div>
      ))}
    </div>
  );
}
