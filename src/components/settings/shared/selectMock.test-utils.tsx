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
 *   vi.mock("@/components/ui/select", () => import("../shared/selectMock.test-utils"));
 */
import React from "react";
import type { ReactElement, ReactNode } from "react";

interface SelectTriggerProps { "aria-label"?: string; className?: string; children?: ReactNode }
interface SelectContentProps { children?: ReactNode }
interface SelectItemProps { value: string; disabled?: boolean; children?: ReactNode }

function Select({ value, onValueChange, disabled, children }: { value?: string; onValueChange?: (value: string) => void; disabled?: boolean; children?: ReactNode }) {
  const childList = React.Children.toArray(children);
  const trigger = childList.find(
    (child): child is ReactElement<SelectTriggerProps> => React.isValidElement(child) && child.type === SelectTrigger,
  );
  const content = childList.find(
    (child): child is ReactElement<SelectContentProps> => React.isValidElement(child) && child.type === SelectContent,
  );
  const items = React.Children.toArray(content?.props.children).filter(
    (child): child is ReactElement<SelectItemProps> => React.isValidElement(child) && child.type === SelectItem,
  );

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

function SelectTrigger(_props: SelectTriggerProps) {
  return null;
}
SelectTrigger.displayName = "MockSelectTrigger";

function SelectValue(_props: { children?: ReactNode }) {
  return null;
}

function SelectContent(_props: SelectContentProps) {
  return null;
}
SelectContent.displayName = "MockSelectContent";

function SelectItem(_props: SelectItemProps) {
  return null;
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
