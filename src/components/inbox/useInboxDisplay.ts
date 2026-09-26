import { useState } from "react";
import { desktopInboxLane, projectInboxDisplay, reopenUnreadLanes, unreadLaneKeys } from "./inboxDisplayModel";
import type { DesktopInboxLane, LaneDisclosure } from "./inboxDisplayModel";
import type { InboxEmailLike, InboxId } from "./inboxTypes";

// Disclosure belongs to the list; its projection is also reported to reader
// navigation and batch selection so neither can target hidden rows.
export default function useInboxDisplay({ emails, selectedId, lane, activeSnapshotMode, focusUnread, scope }: {
  emails: InboxEmailLike[]; selectedId: InboxId | null; lane: string;
  activeSnapshotMode: boolean; focusUnread: boolean; scope: string;
}) {
  const [normalCollapsed, setNormalCollapsed] = useState<LaneDisclosure>({});
  const [filter, setFilter] = useState({ lane, collapsed: false });
  if (filter.lane !== lane) setFilter({ lane, collapsed: false });
  const unreadKeys = unreadLaneKeys(emails);
  const signature = JSON.stringify(unreadKeys);
  const focusScope = JSON.stringify([scope, focusUnread]);
  const [focused, setFocused] = useState({ scope: focusScope, signature, unreadKeys, collapsed: {} as LaneDisclosure, expandedRead: {} as LaneDisclosure });
  let current = focused;
  if (focused.scope !== focusScope) {
    current = { scope: focusScope, signature, unreadKeys, collapsed: {}, expandedRead: {} };
    setFocused(current);
  } else if (focused.signature !== signature) {
    current = { ...focused, signature, unreadKeys, collapsed: focusUnread ? reopenUnreadLanes(focused.collapsed, focused.unreadKeys, unreadKeys) : focused.collapsed };
    setFocused(current);
  }
  const collapsed: LaneDisclosure = focusUnread ? current.collapsed : {
    ...(activeSnapshotMode ? { handled: true, untriaged_read: true } : {}),
    ...normalCollapsed,
    ...(lane !== "__all" ? { [lane]: filter.collapsed } : {}),
  };
  const selected = emails.find(email => email.id === selectedId || email.uid === selectedId);
  const readExpanded = selected ? !!current.expandedRead[desktopInboxLane(selected)] : false;
  const [selection, setSelection] = useState({ id: selectedId, scope: focusScope, heldId: selectedId });
  let heldId = selection.heldId;
  if (selection.id !== selectedId || selection.scope !== focusScope) {
    // Read mail opened inside an expanded disclosure stays there. Mail opened
    // in the primary rows keeps its slot when the automatic read timer fires.
    heldId = selected?.read && readExpanded ? null : selectedId;
    setSelection({ id: selectedId, scope: focusScope, heldId });
  }
  const projection = projectInboxDisplay(emails, { focusUnread, selectedId: readExpanded ? heldId : selectedId, collapsed, expandedRead: current.expandedRead });
  const setCollapsed = (updates: LaneDisclosure) => {
    if (focusUnread) setFocused(previous => ({ ...previous, collapsed: { ...previous.collapsed, ...updates } }));
    else {
      setNormalCollapsed(previous => ({ ...previous, ...Object.fromEntries(Object.entries(updates).filter(([key]) => key !== lane)) }));
      if (lane !== "__all" && updates[lane as DesktopInboxLane] !== undefined) setFilter({ lane, collapsed: !!updates[lane as DesktopInboxLane] });
    }
  };
  return {
    ...projection,
    toggleLane: (key: DesktopInboxLane) => setCollapsed({ [key]: !collapsed[key] }),
    allCollapsed: projection.sections.length > 0 && projection.sections.every(section => section.collapsed),
    toggleAll: () => {
      const next = !projection.sections.every(section => section.collapsed);
      setCollapsed(Object.fromEntries(projection.sections.map(section => [section.lane, next])));
    },
    toggleRead: (key: DesktopInboxLane) => setFocused(previous => ({ ...previous, expandedRead: { ...previous.expandedRead, [key]: !previous.expandedRead[key] } })),
  };
}
