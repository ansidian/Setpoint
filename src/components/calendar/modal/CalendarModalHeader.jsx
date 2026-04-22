import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ListChecks, Receipt, X } from "lucide-react";

const VIEW_OPTIONS = [
  { key: "events", label: "Events", Icon: CalendarIcon, hint: "1" },
  { key: "bills", label: "Bills", Icon: Receipt, hint: "2" },
  { key: "deadlines", label: "Deadlines", Icon: ListChecks, hint: "3" },
];

function headerButtonBaseStyle() {
  return {
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    fontFamily: "inherit",
    transform: "translateY(0)",
    transition: "transform 140ms, background 140ms, border-color 140ms",
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
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", marginBottom: 22, gap: 12 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          alignItems: "center",
          gap: 18,
          justifySelf: "start",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
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
            <ChevronLeft size={16} />
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
            <ChevronRight size={16} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 2.6,
              textTransform: "uppercase",
              color: "rgba(205,214,244,0.55)",
            }}
          >
            Calendar · {viewLabel || "Bills"}
          </div>
          <div
            className="ea-display"
            style={{
              fontSize: 28,
              fontWeight: 500,
              color: "#fff",
              letterSpacing: -0.4,
              lineHeight: 1.05,
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
          display: "flex",
          alignItems: "center",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 8,
          padding: 2,
          gap: 2,
          justifySelf: "center",
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
                event.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(event) => {
                if (active) return;
                event.currentTarget.style.background = "transparent";
                event.currentTarget.style.color = "rgba(205,214,244,0.55)";
                event.currentTarget.style.transform = "translateY(0)";
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: 0.3,
                border: "none",
                cursor: active ? "default" : "pointer",
                fontFamily: "inherit",
                background: active ? "rgba(203,166,218,0.12)" : "transparent",
                color: active ? "#cba6da" : "rgba(205,214,244,0.55)",
                transform: "translateY(0)",
                transition: "transform 140ms, background 150ms, color 150ms",
              }}
            >
              <Icon size={11} strokeWidth={1.8} />
              {option.label}
              <kbd
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 16,
                  height: 16,
                  padding: "0 4px",
                  fontSize: 9.5,
                  fontFamily: "Fira Code, ui-monospace, monospace",
                  fontWeight: 500,
                  color: active ? "#cba6da" : "rgba(205,214,244,0.45)",
                  background: active ? "rgba(203,166,218,0.10)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${active ? "rgba(203,166,218,0.28)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: 4,
                  letterSpacing: 0,
                  marginLeft: 2,
                }}
              >
                {option.hint}
              </kbd>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, justifySelf: "end" }}>
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
        <button
          onClick={onClose}
          aria-label="Close"
          onMouseEnter={(event) => handleHeaderButtonHover(event, true)}
          onMouseLeave={resetHeaderButtonHover}
          style={{
            ...headerButtonBaseStyle(),
            color: "rgba(205,214,244,0.7)",
            cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
