import { Activity, memo } from "react";
import type { ReactNode } from "react";

interface KeepAliveTabProps {
  active: boolean;
  children: ReactNode;
}

// Renders its children, but skips re-rendering entirely while inactive. memo's
// comparator returning true == "props equal, skip render", so an inactive tab is
// never reconciled when the shared parent re-renders (e.g. a dashboard data
// refresh); it stays frozen at its last-active output and re-renders with live
// props the moment it becomes active again. memo (unlike useMemo) is a real
// skip, not a best-effort cache, so the freeze is reliable.
const FrozenWhenHidden = memo(
  function FrozenWhenHidden({ children }: KeepAliveTabProps) {
    return children;
  },
  (_prev, next) => !next.active,
);

/**
 * Keep-alive tab wrapper: mounts children once and keeps them alive across tab
 * switches instead of unmounting/remounting the whole subtree per switch.
 *
 * - <Activity> preserves DOM + state and toggles visibility. Crucially it runs
 *   the subtree's effect cleanup when it becomes hidden, so lifecycle effects
 *   (e.g. InboxView's settle-on-leave) still fire on a tab change.
 * - FrozenWhenHidden stops a parent re-render from reconciling the hidden tab,
 *   so a dashboard data refresh only touches the visible tab.
 */
export default function KeepAliveTab({ active, children }: KeepAliveTabProps) {
  return (
    <Activity mode={active ? "visible" : "hidden"}>
      <FrozenWhenHidden active={active}>{children}</FrozenWhenHidden>
    </Activity>
  );
}
