import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type Ref } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { ACCENT, textFieldStyle } from "./calendarEditorUtils";

interface FieldLabelProps {
  children: ReactNode;
}

export function FieldLabel({ children }: FieldLabelProps) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 2.2,
        textTransform: "uppercase",
        color: "var(--color-text-faint)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

interface FieldValidationMessageProps {
  id: string;
  children: ReactNode;
}

export function FieldValidationMessage({ id, children }: FieldValidationMessageProps) {
  return (
    <div
      id={id}
      aria-live="polite"
      style={{
        marginTop: 6,
        color: "var(--sp-orange)",
        fontSize: 10.5,
        fontWeight: 550,
        lineHeight: 1.4,
      }}
    >
      {children}
    </div>
  );
}

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean;
  subtle?: boolean;
  dataTestId?: string;
  style?: CSSProperties;
}

export function ActionButton({
  children,
  danger = false,
  subtle = false,
  disabled = false,
  onClick,
  dataTestId,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
  onPointerCancel,
  title,
  style,
  ...rest
}: ActionButtonProps) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  let background = "color-mix(in srgb, var(--sp-accent) 12%, transparent)";
  let border = "1px solid color-mix(in srgb, var(--sp-accent) 24%, transparent)";
  let color = "var(--sp-accent)";

  if (danger) {
    background = hover && !disabled ? "color-mix(in srgb, var(--sp-rose) 18%, transparent)" : "color-mix(in srgb, var(--sp-rose) 12%, transparent)";
    border = hover && !disabled ? "1px solid color-mix(in srgb, var(--sp-rose) 38%, transparent)" : "1px solid color-mix(in srgb, var(--sp-rose) 28%, transparent)";
    color = "var(--sp-rose)";
  } else if (subtle) {
    background = hover && !disabled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)";
    border = hover && !disabled ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(255,255,255,0.08)";
    color = "rgba(205,214,244,0.78)";
  } else if (hover && !disabled) {
    background = "color-mix(in srgb, var(--sp-accent) 18%, transparent)";
    border = "1px solid color-mix(in srgb, var(--sp-accent) 34%, transparent)";
  }

  return (
    <button
      data-testid={dataTestId}
      type="button"
      data-calendar-focus-ring="true"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 10px",
        borderRadius: 8,
        border,
        background,
        color: disabled ? "var(--color-text-faint)" : color,
        fontSize: 11.5,
        fontWeight: subtle ? 500 : 600,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        opacity: disabled ? 0.72 : 1,
        transform: hover && !pressed && !disabled ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 140ms, background 140ms, border-color 140ms, color 140ms, opacity 140ms",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

interface PickerFieldButtonProps {
  anchorRef?: Ref<HTMLButtonElement>;
  icon: LucideIcon;
  value?: ReactNode;
  placeholder?: ReactNode;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  dataTestId?: string;
  ariaLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  leading?: ReactNode;
  trailingLabel?: ReactNode;
}

export function PickerFieldButton(props: PickerFieldButtonProps) {
  const {
    anchorRef,
    icon,
    value,
    placeholder,
    onClick,
    dataTestId,
    ariaLabel,
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
      data-calendar-focus-ring="true"
      aria-label={ariaLabel}
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
            color: value ? "var(--sp-text)" : "var(--color-text-faint)",
          }}
        >
          {value || placeholder}
        </span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {trailingLabel ? (
          <span style={{ fontSize: 10, color: "var(--color-text-faint)", whiteSpace: "nowrap" }}>
            {trailingLabel}
          </span>
        ) : null}
        <ChevronDown size={12} color="rgba(205,214,244,0.45)" />
      </span>
    </button>
  );
}
