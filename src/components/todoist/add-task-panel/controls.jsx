import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { FieldLabel } from "../../calendar/events/CalendarEditorControls";

function useFloatingMenu({ open, triggerRef, panelRef, onClose, minWidth = 120, maxHeight = 180 }) {
  const [pos, setPos] = useState(null);

  const updatePos = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(rect.width, minWidth);
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - width - margin),
    );
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const opensAbove = spaceBelow < Math.min(maxHeight, 120) && spaceAbove > spaceBelow;
    const availableHeight = Math.max(96, Math.min(maxHeight, opensAbove ? spaceAbove - 4 : spaceBelow - 4));
    const top = opensAbove
      ? Math.max(margin, rect.top - availableHeight - 4)
      : Math.min(window.innerHeight - margin - availableHeight, rect.bottom + 4);
    setPos({ top, left, width, maxHeight: availableHeight });
  }, [maxHeight, minWidth, triggerRef]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (triggerRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, onClose, panelRef, triggerRef]);

  useEffect(() => {
    const element = panelRef.current;
    if (!open || !element) return undefined;
    function handleWheel(event) {
      const atTop = element.scrollTop <= 0 && event.deltaY < 0;
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1 && event.deltaY > 0;
      if (atTop || atBottom) event.preventDefault();
    }
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [open, panelRef, pos]);

  return pos;
}

function FloatingMenu({ open, triggerRef, panelRef, onClose, children, minWidth = 120, maxHeight = 180 }) {
  const pos = useFloatingMenu({ open, triggerRef, panelRef, onClose, minWidth, maxHeight });
  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
        overscrollBehavior: "contain",
        isolation: "isolate",
        background: "#16161e",
        border: "1px solid rgba(205,214,244,0.12)",
        borderRadius: 8,
        zIndex: 10002,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function PriorityIndicator({ level }) {
  const colors = {
    1: "#f38ba8",
    2: "#f9e2af",
    3: "#89b4fa",
    4: "#a6adc8",
  };
  const color = colors[level] || colors[4];
  const litCount = 5 - level;
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      {[1, 2, 3, 4].map((index) => (
        <span
          key={index}
          style={{
            width: 3,
            height: 10,
            borderRadius: 2,
            background: color,
            opacity: index <= litCount ? 1 : 0.22,
          }}
        />
      ))}
      <span style={{ color, marginLeft: 4, fontSize: 11, fontWeight: 600 }}>
        P{level}
      </span>
    </span>
  );
}

export function Dropdown({
  label,
  value,
  options,
  onChange,
  renderOption,
  renderValue,
  color,
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const borderColor = color ? `${color}33` : "rgba(205,214,244,0.08)";

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <FieldLabel>{label}</FieldLabel>
      <div
        ref={triggerRef}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
        style={{
          background: hover ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${borderColor}`,
          borderRadius: 8,
          padding: "9px 12px",
          fontSize: 12.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          color: color || "rgba(205,214,244,0.35)",
          transform: hover ? "translateY(-1px)" : "translateY(0)",
          transition: "transform 140ms, background 140ms, border-color 140ms",
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <span>{renderValue ? renderValue(value) : value || "None"}</span>
        <ChevronDown size={12} style={{ opacity: 0.5 }} />
      </div>
      <FloatingMenu
        open={open}
        triggerRef={triggerRef}
        panelRef={menuRef}
        onClose={() => setOpen(false)}
        minWidth={160}
        maxHeight={180}
      >
          {options.map((opt, index) => (
            <div
              key={opt.id ?? opt.value ?? index}
              role="button"
              tabIndex={0}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onChange(opt);
                  setOpen(false);
                }
              }}
              style={{
                padding: "8px 12px",
                fontSize: 12,
                cursor: "pointer",
                color: "#cdd6f4",
                borderBottom:
                  index < options.length - 1
                    ? "1px solid rgba(205,214,244,0.06)"
                    : "none",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "rgba(205,214,244,0.06)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
              }}
            >
              {renderOption ? renderOption(opt) : opt.name || opt.label}
            </div>
          ))}
      </FloatingMenu>
    </div>
  );
}

export function TokenAutocomplete({ cursorPos, input, items, type, onSelect }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const trigger = type === "project" ? "#" : "@";
  const textBeforeCursor = input.slice(0, cursorPos);
  const triggerIdx = textBeforeCursor.lastIndexOf(trigger);
  const fragment = triggerIdx >= 0 ? textBeforeCursor.slice(triggerIdx + 1) : null;
  const isActive = fragment !== null && !/\s/.test(fragment);

  const filtered = useMemo(() => {
    if (!isActive) return [];
    const query = fragment.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().startsWith(query)).slice(0, 6);
  }, [fragment, isActive, items]);

  const safeIdx = filtered.length ? Math.min(activeIdx, filtered.length - 1) : 0;

  useEffect(() => {
    if (!filtered.length) return undefined;
    function handleKey(event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIdx((index) => (index + 1) % filtered.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIdx((index) => (index - 1 + filtered.length) % filtered.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        if (filtered[safeIdx]) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(filtered[safeIdx], triggerIdx, cursorPos);
        }
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [cursorPos, filtered, onSelect, safeIdx, triggerIdx]);

  if (!isActive || !filtered.length) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        marginTop: 4,
        background: "#16161e",
        border: "1px solid rgba(205,214,244,0.12)",
        borderRadius: 8,
        maxHeight: 160,
        overflowY: "auto",
        zIndex: 20,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
      }}
    >
      <div
        style={{
          padding: "4px 8px 2px",
          fontSize: 10,
          color: "rgba(205,214,244,0.3)",
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}
      >
        {type === "project" ? "Projects" : "Labels"}
      </div>
      {filtered.map((item, index) => (
        <div
          key={item.id}
          role="button"
          tabIndex={-1}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(item, triggerIdx, cursorPos);
          }}
          onMouseEnter={() => setActiveIdx(index)}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            cursor: "pointer",
            color: type === "project" ? "#cba6da" : "#a6dac0",
            background: index === safeIdx ? "rgba(205,214,244,0.06)" : "transparent",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {type === "project" && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: item.color || "rgba(205,214,244,0.3)",
              }}
            />
          )}
          {item.name}
        </div>
      ))}
    </div>
  );
}

export function LabelPicker({ available, onAdd }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  if (!available.length) return null;

  return (
    <span style={{ position: "relative" }}>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") setOpen((value) => !value);
        }}
        style={{
          color: "rgba(205,214,244,0.3)",
          fontSize: 11,
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 4,
          border: "1px dashed rgba(205,214,244,0.12)",
        }}
      >
        + label
      </span>
      <FloatingMenu
        open={open}
        triggerRef={triggerRef}
        panelRef={menuRef}
        onClose={() => setOpen(false)}
        minWidth={120}
        maxHeight={140}
      >
          {available.map((label) => (
            <div
              key={label.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                onAdd(label);
                setOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onAdd(label);
                  setOpen(false);
                }
              }}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                cursor: "pointer",
                color: "#a6dac0",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "rgba(205,214,244,0.06)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
              }}
            >
              {label.name}
            </div>
          ))}
      </FloatingMenu>
    </span>
  );
}

export function RemoveLabelButton({ onRemove }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onRemove}
      onKeyDown={(event) => {
        if (event.key === "Enter") onRemove();
      }}
      style={{ cursor: "pointer", opacity: 0.6, display: "inline-flex", alignItems: "center" }}
    >
      <X size={12} />
    </span>
  );
}
