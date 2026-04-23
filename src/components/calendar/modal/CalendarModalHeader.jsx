import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ListChecks, Receipt, X } from "lucide-react";

const VIEW_OPTIONS = [
  { key: "events", label: "Events", Icon: CalendarIcon, hint: "1" },
  { key: "bills", label: "Bills", Icon: Receipt, hint: "2" },
  { key: "deadlines", label: "Deadlines", Icon: ListChecks, hint: "3" },
];

function headerButtonBaseStyle() {
  return {
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    fontFamily: "inherit",
    transform: "translateY(0)",
    transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms",
  };
}

function handleHeaderButtonHover(event, active) {
  if (active === false) return;
  event.currentTarget.style.background = "rgba(255,255,255,0.06)";
  event.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
  event.currentTarget.style.transform = "translateY(-1px)";
}

function resetHeaderButtonHover(event) {
  event.currentTarget.style.background = "rgba(255,255,255,0.03)";
  event.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
  event.currentTarget.style.transform = "translateY(0)";
}

function viewToggleStyle(active, stretched = false) {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: stretched ? "center" : "flex-start",
    gap: 8,
    width: stretched ? "100%" : "auto",
    padding: stretched ? "8px 10px" : "8px 14px",
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.24,
    border: `1px solid ${active ? "rgba(203,166,218,0.22)" : "transparent"}`,
    cursor: active ? "default" : "pointer",
    fontFamily: "inherit",
    background: active ? "rgba(203,166,218,0.12)" : "transparent",
    color: active ? "#cba6da" : "rgba(205,214,244,0.56)",
    transform: "translateY(0)",
    transition: "transform 140ms, background 150ms, color 150ms, border-color 150ms",
  };
}

function viewHintStyle(active) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 18,
    height: 18,
    padding: "0 4px",
    fontSize: 9.5,
    fontFamily: "Fira Code, ui-monospace, monospace",
    fontWeight: 500,
    color: active ? "#cba6da" : "rgba(205,214,244,0.45)",
    background: active ? "rgba(203,166,218,0.10)" : "rgba(255,255,255,0.04)",
    border: `1px solid ${active ? "rgba(203,166,218,0.24)" : "rgba(255,255,255,0.06)"}`,
    borderRadius: 4,
    letterSpacing: 0,
    marginLeft: 2,
  };
}

export default function CalendarModalHeader({
  view,
  monthName,
  monthYear,
  layout,
  canGoPrev,
  navigateMonth,
  onViewChange,
  HeaderExtras,
  viewData,
  computed,
  suppressOutsideClick,
  eventEditor,
  selectedDay,
  viewYear,
  viewMonth,
  setDeadlineEditor,
  onClose,
  viewLabel,
}) {
  const titleSize = layout.tier === "xl" ? 40 : layout.tier === "lg" ? 36 : layout.tier === "md" ? 32 : 28;

  return (
    <div
      style={{
        position: "sticky",
        top: -layout.shellPadding,
        zIndex: 2,
        margin: `${-layout.shellPadding}px ${-layout.shellPadding}px 0`,
        padding: `${layout.shellPadding}px ${layout.shellPadding}px ${layout.contentGap}px`,
        background: "linear-gradient(180deg, rgba(22,22,30,0.98), rgba(22,22,30,0.94) 72%, rgba(22,22,30,0))",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: layout.headerStacked ? "minmax(0, 1fr) auto" : "minmax(0, 1fr) auto minmax(0, 1fr)",
          gridTemplateAreas: layout.headerStacked
            ? "\"title actions\" \"views views\""
            : "\"title views actions\"",
          alignItems: "center",
          gap: layout.headerStacked ? 12 : 16,
        }}
      >
        <div
          style={{
            gridArea: "title",
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr)",
            alignItems: "center",
            gap: layout.tier === "xl" ? 20 : 16,
            justifySelf: "start",
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignSelf: "start" }}>
            <button
              onClick={() => canGoPrev && navigateMonth(-1)}
              aria-label="Previous month"
              onMouseEnter={(event) => handleHeaderButtonHover(event, canGoPrev)}
              onMouseLeave={resetHeaderButtonHover}
              style={{
                ...headerButtonBaseStyle(),
                color: canGoPrev ? "rgba(205,214,244,0.7)" : "rgba(205,214,244,0.18)",
                cursor: canGoPrev ? "pointer" : "default",
                flexShrink: 0,
              }}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              onClick={() => navigateMonth(1)}
              aria-label="Next month"
              onMouseEnter={(event) => handleHeaderButtonHover(event, true)}
              onMouseLeave={resetHeaderButtonHover}
              style={{
                ...headerButtonBaseStyle(),
                color: "rgba(205,214,244,0.7)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 2.2,
                textTransform: "uppercase",
                color: "rgba(205,214,244,0.55)",
              }}
            >
              Calendar Workspace · {viewLabel || "Bills"}
            </div>
            <div
              className="ea-display"
              style={{
                fontSize: titleSize,
                fontWeight: 500,
                color: "#fff",
                letterSpacing: -0.7,
                lineHeight: 0.96,
                whiteSpace: layout.headerWrap ? "normal" : "nowrap",
              }}
            >
              {monthName}{" "}
              <span style={{ color: "rgba(205,214,244,0.4)", fontWeight: 400 }}>{monthYear}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            gridArea: "views",
            display: "grid",
            gridTemplateColumns: layout.headerStacked ? "repeat(3, minmax(0, 1fr))" : "repeat(3, auto)",
            alignItems: "center",
            justifySelf: layout.headerStacked ? "stretch" : "center",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 12,
            padding: 4,
            gap: 4,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        >
          {VIEW_OPTIONS.map((option) => {
            const active = view === option.key;
            const { Icon } = option;
            return (
              <button
                key={option.key}
                onClick={() => !active && onViewChange?.(option.key)}
                onMouseEnter={(event) => {
                  if (active) return;
                  event.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  event.currentTarget.style.color = "rgba(205,214,244,0.82)";
                  event.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  event.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(event) => {
                  if (active) return;
                  event.currentTarget.style.background = "transparent";
                  event.currentTarget.style.color = "rgba(205,214,244,0.55)";
                  event.currentTarget.style.borderColor = "transparent";
                  event.currentTarget.style.transform = "translateY(0)";
                }}
                style={viewToggleStyle(active, layout.headerStacked)}
              >
                <Icon size={11} strokeWidth={1.8} />
                {option.label}
                <kbd style={viewHintStyle(active)}>
                  {option.hint}
                </kbd>
              </button>
            );
          })}
        </div>

        <div
          style={{
            gridArea: "actions",
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifySelf: "end",
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {HeaderExtras ? (
              <HeaderExtras
                data={viewData}
                computed={computed}
                suppressOutsideClick={suppressOutsideClick}
                editor={eventEditor}
                selectedDay={selectedDay}
                viewYear={viewYear}
                viewMonth={viewMonth}
                onCreateTask={(seedDate) => {
                  setDeadlineEditor({
                    mode: "create",
                    seedDate: seedDate || null,
                  });
                }}
              />
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            onMouseEnter={(event) => handleHeaderButtonHover(event, true)}
            onMouseLeave={resetHeaderButtonHover}
            style={{
              ...headerButtonBaseStyle(),
              color: "rgba(205,214,244,0.7)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
