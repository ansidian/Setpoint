/**
 * Shared test double for `@/components/ui/select`.
 *
 * The real Radix-based Select renders a portal-driven listbox that is awkward to
 * drive in happy-dom. For settings-card tests we only care about the behavioral
 * contract: a labeled control whose value/disabled state mirror the props and
 * whose change fires `onValueChange`. This renders a native `<select>` that
 * preserves the trigger's aria-label/className and each item's disabled flag.
 *
 * Usage inside a test file:
 *   vi.mock("@/components/ui/select", () => import("../shared/selectMock.jsx"));
 */
import React from "react";

function Select({ value, onValueChange, disabled, children }) {
  const childList = React.Children.toArray(children);
  const trigger = childList.find(
    (child) => React.isValidElement(child) && child.type?.displayName === "MockSelectTrigger",
  );
  const content = childList.find(
    (child) => React.isValidElement(child) && child.type?.displayName === "MockSelectContent",
  );
  const items = React.Children.toArray(content?.props?.children).filter(React.isValidElement);

  return (
    <select
      aria-label={trigger?.props?.["aria-label"]}
      className={trigger?.props?.className}
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {items.map((item) => (
        <option key={item.props.value} value={item.props.value} disabled={item.props.disabled}>
          {item.props.children}
        </option>
      ))}
    </select>
  );
}

function SelectTrigger() {
  return null;
}
SelectTrigger.displayName = "MockSelectTrigger";

function SelectValue() {
  return null;
}

function SelectContent() {
  return null;
}
SelectContent.displayName = "MockSelectContent";

function SelectItem() {
  return null;
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
