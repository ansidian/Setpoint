import { useCallback, useEffect, useState } from "react";
import { emailSelectionKey } from "./inboxBatchModel";
import type { InboxEmailLike } from "./inboxTypes";

export interface InboxRowModifiers { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; }
export interface BatchSelectionState { keys: ReadonlySet<string>; anchor: string | null; }
const emptySelection = (): BatchSelectionState => ({ keys: new Set(), anchor: null });

export function selectBatchRow(state: BatchSelectionState, email: InboxEmailLike, modifiers: InboxRowModifiers, displayed: readonly string[], current: InboxEmailLike | null): BatchSelectionState {
  const key = emailSelectionKey(email);
  if (!key) return state;
  const keys = new Set(state.keys);
  if (modifiers.shiftKey && !modifiers.metaKey && !modifiers.ctrlKey) {
    const currentKey = current ? emailSelectionKey(current) : null;
    const anchor = keys.size ? state.anchor || key : currentKey && displayed.includes(currentKey) ? currentKey : key;
    const from = displayed.indexOf(anchor);
    const to = displayed.indexOf(key);
    if (from >= 0 && to >= 0) for (const id of displayed.slice(Math.min(from, to), Math.max(from, to) + 1)) keys.add(id);
    else keys.add(key);
    return { keys, anchor };
  }
  if (!keys.size && current && displayed.includes(emailSelectionKey(current))) keys.add(emailSelectionKey(current));
  if (keys.has(key)) keys.delete(key); else keys.add(key);
  return { keys, anchor: key };
}

export default function useInboxBatchSelection({ scope, enabled, emails, pendingEmails }: {
  scope: string; enabled: boolean; emails: InboxEmailLike[]; pendingEmails: readonly InboxEmailLike[];
}) {
  const [state, setState] = useState(emptySelection);
  const [displayed, setDisplayed] = useState<{ keys: readonly string[]; source: string }>({ keys: [], source: "[]" });
  const sourceSignature = JSON.stringify(emails.map(emailSelectionKey));
  const clear = useCallback(() => { setState(emptySelection()); }, []);
  useEffect(() => {
    // Scope is the selection boundary, including React Activity hide cleanup.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize selection to the external view/activity boundary
    clear();
    return clear;
  }, [scope, enabled, clear]);
  useEffect(() => {
    window.addEventListener("popstate", clear);
    return () => window.removeEventListener("popstate", clear);
  }, [clear]);
  const reportDisplayed = useCallback((keys: readonly string[], sourceKeys: readonly string[] = keys) => {
    const source = JSON.stringify(sourceKeys);
    setDisplayed(previous => previous.source === source && previous.keys.length === keys.length && previous.keys.every((key, index) => key === keys[index]) ? previous : { keys, source });
  }, []);
  useEffect(() => {
    // The child list must report this exact projection before we prune. A batch
    // failure can restore rows in the same render that releases pending targets.
    if (displayed.source !== sourceSignature) return;
    const available = new Set([...displayed.keys, ...pendingEmails.map(emailSelectionKey)]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prune selection against the list-reported displayed identities
    setState(previous => {
      const keys = new Set([...previous.keys].filter(key => available.has(key)));
      return keys.size === previous.keys.size ? previous : { ...previous, keys };
    });
  }, [displayed, pendingEmails, sourceSignature]);
  const remove = useCallback((rows: readonly InboxEmailLike[]) => {
    const removed = new Set(rows.map(emailSelectionKey));
    setState(previous => ({ ...previous, keys: new Set([...previous.keys].filter(key => !removed.has(key))) }));
  }, []);
  const select = useCallback((email: InboxEmailLike, modifiers: InboxRowModifiers, current: InboxEmailLike | null) => {
    setState(previous => selectBatchRow(previous, email, modifiers, displayed.keys, current));
  }, [displayed]);
  const byKey = new Map([...pendingEmails, ...emails].map(email => [emailSelectionKey(email), email]));
  const selectedEmails = enabled ? [...state.keys].flatMap(key => byKey.get(key) ? [byKey.get(key)!] : []) : [];
  const displayedEmails = displayed.source === sourceSignature
    ? displayed.keys.flatMap(key => byKey.has(key) ? [byKey.get(key)!] : []) : [];
  return { displayedEmails, active: enabled && state.keys.size > 0, keys: state.keys, selectedEmails, clear, select, reportDisplayed, remove };
}
