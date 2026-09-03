import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export interface ExpandingTextareaProps extends ComponentProps<"textarea"> {
  expandable?: boolean;
}

/** Ordinary notes stay open while focused or populated; long-form editors can opt out. */
export default function ExpandingTextarea({
  expandable = true,
  value,
  defaultValue,
  rows,
  className,
  style,
  onChange,
  onFocus,
  onBlur,
  ...props
}: ExpandingTextareaProps) {
  const [focused, setFocused] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? "");
  const expanded = focused || !!String(value ?? uncontrolledValue).trim();
  const minHeight = typeof style?.minHeight === "string"
    ? style.minHeight
    : Math.max(expanded ? 72 : 38, style?.minHeight ?? 0);

  return (
    <textarea
      {...props}
      value={value}
      defaultValue={defaultValue}
      rows={expandable ? 1 : rows}
      className={cn("sp-expanding-textarea", className)}
      style={{
        ...style,
        ...(expandable ? { minHeight } : {}),
      }}
      onChange={(event) => {
        if (value === undefined) setUncontrolledValue(event.target.value);
        onChange?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
}
