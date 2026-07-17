import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CSSProperties, RefObject } from "react";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function yearNavButtonStyle(): CSSProperties {
  return {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "rgba(205,214,244,0.7)",
    cursor: "pointer",
    fontFamily: "inherit",
    transform: "translateY(0)",
    transition: "background 120ms, border-color 120ms, transform 120ms",
  };
}

function monthCellStyle(isActive: boolean, isToday: boolean): CSSProperties {
  return {
    padding: "7px 0",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: isActive ? 600 : 500,
    fontFamily: "inherit",
    letterSpacing: 0.1,
    cursor: "pointer",
    border: isActive
      ? "1px solid color-mix(in srgb, var(--sp-accent) 28%, transparent)"
      : "1px solid transparent",
    background: isActive
      ? "color-mix(in srgb, var(--sp-accent) 14%, transparent)"
      : "transparent",
    color: isActive
      ? "var(--sp-accent)"
      : isToday
        ? "#ff453a"
        : "rgba(205,214,244,0.65)",
    transform: "translateY(0)",
    transition: "background 120ms, color 120ms, border-color 120ms, transform 120ms",
    position: "relative",
  };
}

export default function CalendarJumpToMonth({
  anchorRef,
  viewYear,
  viewMonth,
  currentYear,
  currentMonth,
  onSelect,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  viewYear: number;
  viewMonth: number;
  currentYear: number;
  currentMonth: number;
  onSelect: (year: number, month: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pickerYear, setPickerYear] = useState(viewYear);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = 232;
    const left = Math.min(rect.left, window.innerWidth - panelWidth - 12);
    setPos({
      top: rect.bottom + 8,
      left: Math.max(12, left),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [updatePosition]);

  useEffect(() => {
    function handleOverflowClose() { onClose(); }
    document.addEventListener("calendar-overflow-close", handleOverflowClose);
    return () => document.removeEventListener("calendar-overflow-close", handleOverflowClose);
  }, [onClose]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (panelRef.current?.contains(event.target as Node)) return;
      if (anchorRef.current?.contains(event.target as Node)) return;
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [anchorRef, onClose]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  function handleSelect(month: number) {
    if (pickerYear === viewYear && month === viewMonth) {
      onClose();
      return;
    }
    onSelect(pickerYear, month);
  }

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Jump to month"
      data-calendar-popover-panel="true"
      data-calendar-month-picker="true"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: 232,
        isolation: "isolate",
        background: "var(--sp-panel)",
        backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
        zIndex: "var(--z-popover)",
        padding: "10px 10px 6px",
        opacity: entered ? 1 : 0,
        transform: entered ? "translateY(0)" : "translateY(-4px)",
        transition: "opacity 120ms ease-out, transform 120ms ease-out",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 6,
        padding: "0 2px",
      }}>
        <button
          type="button"
          onClick={() => setPickerYear((y) => y - 1)}
          aria-label="Previous year"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.03)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
          style={yearNavButtonStyle()}
        >
          <ChevronLeft size={13} />
        </button>
        <span style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#f8faff",
          fontFamily: "inherit",
          letterSpacing: -0.3,
          userSelect: "none",
        }}>
          {pickerYear}
        </span>
        <button
          type="button"
          onClick={() => setPickerYear((y) => y + 1)}
          aria-label="Next year"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.03)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
          style={yearNavButtonStyle()}
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 3,
      }}>
        {MONTH_NAMES.map((name, i) => {
          const isActive = pickerYear === viewYear && i === viewMonth;
          const isToday = pickerYear === currentYear && i === currentMonth;

          return (
            <button
              key={i}
              type="button"
              onClick={() => handleSelect(i)}
              onMouseEnter={(e) => {
                if (isActive) return;
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                e.currentTarget.style.color = "rgba(205,214,244,0.92)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                if (isActive) return;
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = isToday ? "#ff453a" : "rgba(205,214,244,0.65)";
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget.style.transform = "translateY(0)";
              }}
              style={monthCellStyle(isActive, isToday)}
            >
              {name}
              {isToday && !isActive ? (
                <span style={{
                  position: "absolute",
                  bottom: 2,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 3,
                  height: 3,
                  borderRadius: "50%",
                  background: "#ff453a",
                }} />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
