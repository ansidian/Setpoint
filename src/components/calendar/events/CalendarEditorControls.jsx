import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ACCENT, textFieldStyle } from "./calendarEditorUtils";

export function FieldLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 2.2,
        textTransform: "uppercase",
        color: "rgba(205,214,244,0.5)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

export function ActionButton({
  children,
  danger = false,
  subtle = false,
  disabled = false,
  onClick,
  dataTestId,
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  let background = "rgba(203,166,218,0.12)";
  let border = "1px solid rgba(203,166,218,0.24)";
  let color = "#cba6da";

  if (danger) {
    background = hover && !disabled ? "rgba(243,139,168,0.18)" : "rgba(243,139,168,0.12)";
    border = hover && !disabled ? "1px solid rgba(243,139,168,0.38)" : "1px solid rgba(243,139,168,0.28)";
    color = "#f38ba8";
  } else if (subtle) {
    background = hover && !disabled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)";
    border = hover && !disabled ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(255,255,255,0.08)";
    color = "rgba(205,214,244,0.78)";
  } else if (hover && !disabled) {
    background = "rgba(203,166,218,0.18)";
    border = "1px solid rgba(203,166,218,0.34)";
  }

  return (
    <button
      data-testid={dataTestId}
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        border,
        background,
        color: disabled ? "rgba(205,214,244,0.38)" : color,
        fontSize: 11.5,
        fontWeight: subtle ? 500 : 600,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        opacity: disabled ? 0.72 : 1,
        transform: hover && !pressed && !disabled ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms, opacity 140ms",
      }}
    >
      {children}
    </button>
  );
}

export function stopKeyPropagation(event) {
  event.stopPropagation();
}

export function PickerFieldButton(props) {
  const {
    anchorRef,
    icon,
    value,
    placeholder,
    onClick,
    dataTestId,
    disabled = false,
    invalid = false,
    leading = null,
    trailingLabel = "Edit",
  } = props;
  const Icon = icon;
  const [hover, setHover] = useState(false);

  return (
    <button
      ref={anchorRef}
      data-testid={dataTestId}
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...textFieldStyle({ invalid }),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        background: hover && !disabled ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.03)",
        transform: hover && !disabled ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 140ms, background 140ms, border-color 140ms",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          flex: "1 1 auto",
        }}
      >
        {leading || (
          <span
            aria-hidden
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              display: "inline-grid",
              placeItems: "center",
              background: `color-mix(in srgb, ${ACCENT} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${ACCENT} 24%, transparent)`,
              color: ACCENT,
              flexShrink: 0,
            }}
          >
            <Icon size={12} />
          </span>
        )}
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: value ? "#cdd6f4" : "rgba(205,214,244,0.42)",
          }}
        >
          {value || placeholder}
        </span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {trailingLabel ? (
          <span style={{ fontSize: 10, color: "rgba(205,214,244,0.38)", whiteSpace: "nowrap" }}>
            {trailingLabel}
          </span>
        ) : null}
        <ChevronDown size={12} color="rgba(205,214,244,0.45)" />
      </span>
    </button>
  );
}
