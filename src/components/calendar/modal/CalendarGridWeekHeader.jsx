import { DAYS } from "./calendarGridUtils.js";

export default function CalendarGridWeekHeader({ gap }) {
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
            color: "rgba(205,214,244,0.4)",
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
