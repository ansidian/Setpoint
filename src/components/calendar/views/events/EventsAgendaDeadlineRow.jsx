import { CheckCircle2, CircleDashed } from "lucide-react";
import { colorWithAlpha } from "./eventsAgendaColor.js";

function AgendaDeadlineStatus({ deadline }) {
  if (!deadline.agendaStatusIcon) return null;
  const Icon = deadline.agendaStatusIcon === "complete" ? CheckCircle2 : CircleDashed;
  const color = deadline.agendaStatusIcon === "complete" ? "#a6e3a1" : "#89dceb";

  return (
    <span
      data-testid={`events-agenda-deadline-status-${deadline.agendaItemId}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        justifySelf: "end",
        alignSelf: "start",
        minHeight: 18,
        padding: "2px 5px",
        borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${color} 30%, rgba(255,255,255,0.06))`,
        background: `color-mix(in srgb, ${color} 10%, rgba(255,255,255,0.025))`,
        color,
        fontSize: 9.5,
        fontWeight: 750,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <Icon
        data-events-agenda-deadline-status-icon={deadline.agendaStatusIcon}
        aria-hidden="true"
        focusable="false"
        size={11}
        strokeWidth={2.4}
      />
      <span>{deadline.agendaStatus}</span>
    </span>
  );
}

export default function EventsAgendaDeadlineRow({
  deadline,
  dateKey,
  selected,
  registerRow,
  onSelect,
}) {
  const color = deadline.agendaSourceColor || "#89b4fa";
  const TitleTag = deadline.agendaComplete ? "s" : "span";

  return (
    <button
      key={`deadline-${deadline.agendaItemId}-${dateKey}`}
      ref={(node) => registerRow(`${deadline.agendaItemId}-${dateKey}`, node, dateKey)}
      type="button"
      data-testid="calendar-agenda-deadline-row"
      data-item-id={deadline.agendaItemId}
      onClick={(clickEvent) => onSelect(deadline, clickEvent.currentTarget)}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "8px minmax(0, 1fr) auto",
        alignItems: "start",
        columnGap: 8,
        padding: "8px 9px",
        borderRadius: 8,
        border: selected ? `1px solid ${colorWithAlpha(color, 0.72)}` : "1px solid rgba(255,255,255,0.055)",
        background: selected ? colorWithAlpha(color, 0.16) : "rgba(255,255,255,0.022)",
        color: deadline.agendaComplete ? "rgba(205,214,244,0.48)" : "#cdd6f4",
        cursor: "pointer",
        textAlign: "left",
        transition: "transform 170ms cubic-bezier(0.16, 1, 0.3, 1), background-color 170ms cubic-bezier(0.16, 1, 0.3, 1), border-color 170ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onMouseEnter={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(-1px)";
        if (!selected) eventObject.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
      }}
      onMouseLeave={(eventObject) => {
        eventObject.currentTarget.style.transform = "translateY(0)";
        if (!selected) eventObject.currentTarget.style.borderColor = "rgba(255,255,255,0.055)";
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          marginTop: 5,
          borderRadius: 999,
          background: color,
          boxShadow: selected ? `0 0 0 3px ${colorWithAlpha(color, 0.16)}` : "none",
        }}
      />
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ color: "rgba(166,173,200,0.82)", fontSize: 10, fontWeight: 650, fontVariantNumeric: "tabular-nums", lineHeight: 1.25 }}>
          {deadline.agendaTimeRange}
        </span>
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            color: deadline.agendaComplete ? "rgba(205,214,244,0.58)" : "#f1f2fb",
            fontSize: 12,
            fontWeight: 650,
            lineHeight: 1.25,
            textDecoration: deadline.agendaComplete ? "line-through" : "none",
            textDecorationColor: "rgba(205,214,244,0.28)",
          }}
        >
          <TitleTag>{deadline.agendaTitle}</TitleTag>
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(166,173,200,0.62)", fontSize: 10.5, lineHeight: 1.3 }}>
          {deadline.agendaSubtitle}
        </span>
      </span>
      <AgendaDeadlineStatus deadline={deadline} />
    </button>
  );
}
