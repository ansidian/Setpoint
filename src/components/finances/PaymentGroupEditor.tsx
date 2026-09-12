import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, MeasuringStrategy, closestCenter, pointerWithin, rectIntersection, useSensor, useSensors, useDroppable, defaultDropAnimationSideEffects } from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent, DragOverEvent, DropAnimationFunction } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, defaultAnimateLayoutChanges } from '@dnd-kit/sortable';
import { CSS, useCombinedRefs } from '@dnd-kit/utilities';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import type { PaymentGroup, PaymentItem, PaymentOrganization } from '../../../shared/types/payment-groups';
import type { PaymentPresentationRow } from './paymentPresentationModel';
import { savePaymentOrganization } from '../../api';
import { createClientId } from '../../lib/clientId';
import PaymentRowContent from './PaymentRowContent';
import './payment-groups.css';

type Picked = { kind: 'group' | 'item'; id: string; name: string };
type Props = { organization: PaymentOrganization; items: PaymentItem[]; rows: PaymentPresentationRow[]; onSave: (value: PaymentOrganization) => void; onCancel: () => void };
const groupKey = (id: string) => `group:${id}`;
const headingKey = (id: string) => `heading:${id}`;
const transition = { duration: 180, easing: 'cubic-bezier(.2,.7,.2,1)' };
const animation = (args: Parameters<typeof defaultAnimateLayoutChanges>[0]) => defaultAnimateLayoutChanges({ ...args, wasDragging: true });
const itemIdentity = (row: PaymentPresentationRow) => row.utilityId ? `utility:${row.utilityId}` : `schedule:${row.scheduleId}`;

function moveItem(value: PaymentOrganization, id: string, groupId: string, index: number): PaymentOrganization {
  const source = value.groups.find(group => group.itemIds.includes(id));
  const destination = value.groups.find(group => group.id === groupId);
  if (!source || !destination) return value;
  if (source === destination && source.itemIds.indexOf(id) === index) return value;
  return { ...value, groups: value.groups.map(group => {
    const itemIds = group.itemIds.filter(item => item !== id);
    if (group.id === groupId) itemIds.splice(Math.min(index, itemIds.length), 0, id);
    return { ...group, itemIds };
  }) };
}

export default function PaymentGroupEditor({ organization, items, rows, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(organization));
  const draftRef = useRef(draft);
  const update = (value: PaymentOrganization) => { draftRef.current = value; setDraft(value); };
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const [renameError, setRenameError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [settlingGroup, setSettlingGroup] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [announcement, announce] = useState('');
  const snapshot = useRef(draft);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const lastCollision = useRef<string | null>(null);
  const landingLatch = useRef<{ id: string; x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const expansionAnchor = useRef<{ id: string; top: number; scroller: HTMLElement } | null>(null);
  const groupHeadings = useRef<Array<{ node: HTMLElement; top: number }>>([]);
  const foldAnimations = useRef<Animation[]>([]);
  const reduced = useReducedMotion();
  const collapsedGroups = picked?.kind === 'group' || !!settlingGroup;
  const stopFolding = () => {
    foldAnimations.current.forEach(animation => animation.cancel());
    foldAnimations.current = [];
  };
  const captureGroupHeadings = () => {
    groupHeadings.current = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.fin-group-head') || [], node => ({ node, top: node.getBoundingClientRect().top }));
    stopFolding();
  };
  useLayoutEffect(() => {
    if (!collapsedGroups || reduced) {
      foldAnimations.current.forEach(animation => animation.cancel());
      foldAnimations.current = [];
      return;
    }
    // The compact drop targets settle immediately; only their visible headings move.
    // Keeping this transform off the sortable section avoids changing hit areas mid-drag.
    foldAnimations.current = groupHeadings.current.flatMap(({ node, top }) => {
      const distance = top - node.getBoundingClientRect().top;
      if (!distance || node.parentElement?.dataset.placeholder === 'true') return [];
      const animation = node.animate([{ transform: `translateY(${distance}px)` }, { transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
      void animation.finished.catch(() => {});
      return [animation];
    });
  }, [collapsedGroups, reduced]);
  useEffect(() => () => { foldAnimations.current.forEach(animation => animation.cancel()); }, []);
  const rememberGroupPosition = (id: string) => {
    const heading = rootRef.current?.querySelector<HTMLElement>(`[data-group-title="${globalThis.CSS.escape(id)}"]`);
    const scroller = rootRef.current?.closest<HTMLElement>(window.matchMedia('(max-width: 767px)').matches ? '.fin-workspace' : '.fin-overview');
    if (heading && scroller) expansionAnchor.current = { id, top: heading.getBoundingClientRect().top, scroller };
  };
  useLayoutEffect(() => {
    const anchor = expansionAnchor.current;
    if (collapsedGroups || !anchor) return;
    const heading = rootRef.current?.querySelector<HTMLElement>(`[data-group-title="${globalThis.CSS.escape(anchor.id)}"]`);
    if (heading) anchor.scroller.scrollTop += heading.getBoundingClientRect().top - anchor.top;
    expansionAnchor.current = null;
  }, [collapsedGroups]);
  useEffect(() => { rootRef.current?.querySelector<HTMLElement>('.fin-group-title')?.focus({preventScroll:true}); }, []);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 5 } }));
  const knownItems = new Map(items.map(item => [item.id, item]));
  const rowByItem = new Map<string, PaymentPresentationRow>();
  // Prefer a received statement as the representative in Organize; all occurrences move together.
  for (const row of rows) if (!rowByItem.has(itemIdentity(row)) || row.amountKind === 'statement') rowByItem.set(itemIdentity(row), row);
  const changed = JSON.stringify(draft) !== JSON.stringify(organization) || !!rename && rename.value.trim() !== draft.groups.find(group => group.id === rename.id)?.name;
  const disabled = saving || !!rename || !!settlingGroup && !picked;
  const focus = (kind: Picked['kind'], id: string) => requestAnimationFrame(() => {
    rootRef.current?.querySelector<HTMLElement>(kind === 'group' ? `[data-group-title="${globalThis.CSS.escape(id)}"]` : `[data-payment-item="${globalThis.CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  });
  const renameValue = (): PaymentOrganization | null => {
    if (!rename) return draftRef.current;
    const name = rename.value.trim();
    if (!name || name.length > 60) { setRenameError('Use a name between 1 and 60 characters.'); return null; }
    if (draftRef.current.groups.some(group => group.id !== rename.id && group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { setRenameError('Choose a different group name.'); return null; }
    return { ...draftRef.current, groups: draftRef.current.groups.map(group => group.id === rename.id ? { ...group, name } : group) };
  };
  const commitRename = () => { const next = renameValue(); if (next && rename) { const id = rename.id; update(next); setRename(null); setRenameError(''); focus('group', id); } };
  const save = async () => {
    const next = renameValue(); if (!next) return;
    update(next); setSaving(true); setError('');
    try { onSave(await savePaymentOrganization(next)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save groups. Try Save again.'); setSaving(false); }
  };
  const addGroup = () => {
    let name = 'New group', index = 2;
    while (draft.groups.some(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `New group ${index++}`;
    const id = createClientId(); update({ ...draft, groups: [...draft.groups, { id, name, itemIds: [] }] }); setRename({ id, value: name }); setRenameError('');
  };
  const restore = () => { stopFolding(); if (keyboard && picked?.kind === 'group') rememberGroupPosition(picked.id); update(snapshot.current); setPicked(null); setKeyboard(false); landingLatch.current = null; announce('Move canceled.'); };
  const groupDropAnimation: DropAnimationFunction = async args => {
    const { active, dragOverlay, transform } = args;
    const cleanup = defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } })(args);
    try {
      if (!reduced) {
        const landing = { ...transform, x: transform.x + active.rect.left - dragOverlay.rect.left, y: transform.y + active.rect.top - dragOverlay.rect.top };
        const landingAnimation = dragOverlay.node.animate([{ transform: CSS.Transform.toString(transform) }, { transform: CSS.Transform.toString(landing) }], { ...transition, fill: 'forwards' });
        await Promise.all([landingAnimation, ...foldAnimations.current].map(animation => animation.finished.catch(() => {})));
      }
    } finally {
      cleanup?.();
      rememberGroupPosition(active.data.current!.identity);
      setSettlingGroup(null);
    }
  };

  const cancelKeyboardMove = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key !== 'Escape' || !keyboard || !picked) return;
    event.preventDefault(); event.stopPropagation();
    const identity = picked; restore(); focus(identity.kind, identity.id);
  });
  useEffect(() => {
    window.addEventListener('keydown', cancelKeyboardMove, true);
    return () => window.removeEventListener('keydown', cancelKeyboardMove, true);
  }, []);

  const collision: CollisionDetection = args => {
    if (args.active.data.current?.kind === 'group') {
      const latch = landingLatch.current;
      // Folding beneath a held pointer must not itself select a different position.
      if (latch && args.pointerCoordinates && Math.hypot(args.pointerCoordinates.x - latch.x, args.pointerCoordinates.y - latch.y) < 20) return [{ id: latch.id }];
      landingLatch.current = null;
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(container => container.data.current?.kind === 'group') });
    }
    pointer.current = args.pointerCoordinates;
    const latch = landingLatch.current;
    if (latch && args.pointerCoordinates && Math.hypot(args.pointerCoordinates.x - latch.x, args.pointerCoordinates.y - latch.y) < 10) return [{ id: latch.id }];
    landingLatch.current = null;
    const hits = pointerWithin(args);
    const heading = hits.find(hit => args.droppableContainers.find(container => container.id === hit.id)?.data.current?.kind === 'heading');
    const item = hits.find(hit => hit.id !== args.active.id && args.droppableContainers.find(container => container.id === hit.id)?.data.current?.kind === 'item');
    const group = hits.find(hit => args.droppableContainers.find(container => container.id === hit.id)?.data.current?.kind === 'group');
    const selected = heading || item || group;
    if (selected) { lastCollision.current = String(selected.id); return [selected]; }
    const overlaps = rectIntersection({ ...args, droppableContainers: args.droppableContainers.filter(container => container.data.current?.kind !== 'heading') });
    return overlaps.length ? overlaps : lastCollision.current ? [{ id: lastCollision.current }] : [];
  };
  const dragOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.data.current?.kind !== 'item') return;
    const value = draftRef.current;
    const id = String(active.id), target = over.data.current;
    const source = value.groups.find(group => group.itemIds.includes(id));
    const destination = value.groups.find(group => group.id === target?.groupId);
    if (!source || !destination) return;
    if (target?.kind === 'heading') {
      update(moveItem(value, id, destination.id, 0));
      if (pointer.current) landingLatch.current = { id: String(over.id), ...pointer.current };
    } else if (source !== destination) {
      const overIndex = destination.itemIds.indexOf(String(over.id));
      const below = pointer.current && pointer.current.y > over.rect.top + over.rect.height / 2;
      update(moveItem(value, id, destination.id, overIndex < 0 ? destination.itemIds.length : overIndex + (below ? 1 : 0)));
      // Hold the newly reserved space until the pointer moves deliberately. Reflow
      // beneath a stationary pointer must not change a below-row drop into an above-row drop.
      if (pointer.current) landingLatch.current = { id, ...pointer.current };
    }
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    const value = draftRef.current;
    if (!over) { restore(); return; }
    if (active.data.current?.kind === 'group') {
      const from = value.groups.findIndex(group => groupKey(group.id) === active.id), to = value.groups.findIndex(group => groupKey(group.id) === over.id);
      if (from >= 0 && to >= 0) update({ ...value, groups: arrayMove(value.groups, from, to) });
    } else if (over.data.current?.kind === 'item' && landingLatch.current?.id !== String(active.id)) {
      const source = value.groups.find(group => group.itemIds.includes(String(active.id)));
      const target = value.groups.find(group => group.itemIds.includes(String(over.id)));
      if (source && target && source === target) update(moveItem(value, String(active.id), target.id, target.itemIds.indexOf(String(over.id))));
    }
    setPicked(null); landingLatch.current = null; lastCollision.current = null;
  };
  const keyMove = (event: KeyboardEvent, identity: Picked) => {
    if (disabled) return;
    if (!picked && (event.key === ' ' || event.key === 'Enter')) {
      if (identity.kind === 'group') captureGroupHeadings();
      event.preventDefault(); snapshot.current = structuredClone(draftRef.current); setPicked(identity); setKeyboard(true); announce(`${identity.name} picked up. Use arrow keys to move, then Space to drop.`); return;
    }
    if (!keyboard || picked?.id !== identity.id) return;
    if ([' ', 'Enter', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); if (event.key === 'Escape') restore(); else { if (identity.kind === 'group') { stopFolding(); rememberGroupPosition(identity.id); } setPicked(null); setKeyboard(false); announce(`${identity.name} dropped.`); } focus(identity.kind, identity.id); return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const value = draftRef.current, forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const groupIndex = value.groups.findIndex(group => identity.kind === 'group' ? group.id === identity.id : group.itemIds.includes(identity.id));
    if (identity.kind === 'group') {
      const next = groupIndex + (forward ? 1 : -1);
      if (next >= 0 && next < value.groups.length) { update({ ...value, groups: arrayMove(value.groups, groupIndex, next) }); announce(`${identity.name}, group ${next + 1} of ${value.groups.length}.`); }
    } else {
      const group = value.groups[groupIndex]!;
      const index = group.itemIds.indexOf(identity.id), next = index + (forward ? 1 : -1);
      const cross = ['ArrowLeft', 'ArrowRight'].includes(event.key) || next < 0 || next >= group.itemIds.length;
      const destination = cross ? value.groups[groupIndex + (forward ? 1 : -1)] : group;
      if (destination) { update(moveItem(value, identity.id, destination.id, cross ? forward ? 0 : destination.itemIds.length : next)); announce(`${identity.name}, in ${destination.name}.`); }
    }
    focus(identity.kind, identity.id);
  };
  const activeGroup = picked?.kind === 'group' ? draft.groups.find(group => group.id === picked.id) : undefined;
  const activeItem = picked?.kind === 'item' ? knownItems.get(picked.id) : undefined;
  const displayItems = (group: PaymentGroup) => group.itemIds.flatMap(id => knownItems.get(id) || []);
  return <motion.div ref={rootRef} className="fin-group-editor" data-dragging={!!picked} data-reordering-groups={collapsedGroups} initial={{opacity:reduced?1:0}} animate={{opacity:1}} transition={{duration:reduced?0:.18}} onMouseDownCapture={keyboard ? event => event.stopPropagation() : undefined} onTouchStartCapture={keyboard ? event => event.stopPropagation() : undefined}>
    <div className="fin-organize-bar"><span>Organize payments</span><motion.div layout="position" layoutId="organize-actions" transition={{duration:reduced?0:.26,ease:[.16,1,.3,1]}}><button disabled={saving || !!picked || !!settlingGroup} onClick={onCancel}>Cancel</button><button className="fin-save-groups" disabled={saving || !changed || !!picked || !!settlingGroup} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></motion.div></div>
    {error && <p role="alert" className="fin-group-error">{error}</p>}
    <p id="fin-drag-instructions" className="sr-only">Drag a payment into a group, or drag a heading to reorder groups. Groups collapse while moving a heading. With a row or heading focused, press Space to pick up, arrow keys to move, Space to drop, or Escape to cancel the move.</p>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    <DndContext sensors={sensors} collisionDetection={collision} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={({ active, activatorEvent }) => {
      snapshot.current = structuredClone(draftRef.current); setKeyboard(false); landingLatch.current = null; lastCollision.current = null;
      // Capture the heading before collapse so its preview stays under the pointer.
      const heading = active.data.current?.kind === 'group' ? rootRef.current?.querySelector<HTMLElement>(`[data-group-title="${globalThis.CSS.escape(active.data.current.identity)}"]`)?.parentElement : null;
      const rect = heading?.getBoundingClientRect();
      if (rect) captureGroupHeadings();
      const source = 'touches' in activatorEvent ? (activatorEvent as TouchEvent).touches[0] : activatorEvent as MouseEvent;
      if (rect && source) landingLatch.current = { id: String(active.id), x: source.clientX, y: source.clientY };
      setSettlingGroup(rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null);
      setPicked({ kind: active.data.current!.kind, id: active.data.current!.identity, name: active.data.current!.name });
    }} onDragOver={dragOver} onDragEnd={dragEnd} onDragCancel={restore} accessibility={{ screenReaderInstructions: { draggable: 'Press Space to pick up. Use arrow keys to move, Space to drop, or Escape to cancel.' }, announcements: {
      onDragStart: ({ active }) => `${active.data.current?.name} picked up.`,
      onDragOver: ({ active, over }) => over ? `${active.data.current?.name}, ${over.data.current?.name}.` : undefined,
      onDragEnd: ({ active }) => `${active.data.current?.name} dropped. Changes are ready to save.`,
      onDragCancel: () => 'Move canceled.',
    } }}>
      <SortableContext items={draft.groups.map(group => groupKey(group.id))} strategy={verticalListSortingStrategy}>
        {draft.groups.map(group => <EditableGroup key={group.id} group={group} items={displayItems(group)} rows={rowByItem} disabled={disabled} reduced={!!reduced} saving={saving} picked={picked} collapsed={collapsedGroups} onKeyMove={keyMove} rename={rename?.id === group.id ? rename : null} renameError={rename?.id === group.id ? renameError : ''}
          onRename={() => { setRename({ id: group.id, value: group.name }); setRenameError(''); }} onRenameValue={value => { setRename({ id: group.id, value }); setRenameError(''); }} onRenameSave={commitRename} onRenameCancel={() => { setRename(null); setRenameError(''); focus('group', group.id); }}
          onRemove={group.id !== 'ungrouped' && !group.itemIds.length ? () => { update({ ...draft, groups: draft.groups.filter(item => item.id !== group.id) }); setRename(null); } : undefined}/>) }
      </SortableContext>
      {createPortal(<DragOverlay style={settlingGroup || undefined} dropAnimation={settlingGroup ? groupDropAnimation : reduced ? null : { ...transition, sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }) }}>
        {!keyboard && picked && <div className="fin-workspace fin-drag-overlay">{activeGroup ? <section className="fin-edit-group"><div className="fin-group-head"><span className="fin-group-title">{activeGroup.name}<span>{displayItems(activeGroup).length}</span></span></div></section> : activeItem ? <div className="fin-edit-row"><PaymentRowContent name={activeItem.name} row={rowByItem.get(activeItem.id)} editing/></div> : null}</div>}
      </DragOverlay>, document.body)}
    </DndContext>
    <button className="fin-add-group" onClick={addGroup} disabled={disabled || !!picked}><Plus size={14}/>Add group</button>
  </motion.div>;
}

type GroupProps = { group: PaymentGroup; items: PaymentItem[]; rows: Map<string, PaymentPresentationRow>; disabled: boolean; reduced: boolean; saving: boolean; picked: Picked | null; collapsed: boolean; onKeyMove: (event: KeyboardEvent, identity: Picked) => void; rename: { value: string } | null; renameError: string; onRename: () => void; onRenameValue: (value: string) => void; onRenameSave: () => void; onRenameCancel: () => void; onRemove?: () => void };
function EditableGroup({ group, items, rows, disabled, reduced, saving, picked, collapsed, onKeyMove, rename, renameError, onRename, onRenameValue, onRenameSave, onRenameCancel, onRemove }: GroupProps) {
  const { attributes, listeners, setDroppableNodeRef, setDraggableNodeRef, setActivatorNodeRef, transform, transition: sortableTransition, isDragging } = useSortable({ id: groupKey(group.id), data: { kind: 'group', identity: group.id, groupId: group.id, name: group.name }, disabled, transition: reduced ? null : transition, animateLayoutChanges: args => collapsed && animation(args) });
  const { setNodeRef: setHeadingRef, isOver } = useDroppable({ id: headingKey(group.id), data: { kind: 'heading', groupId: group.id, name: group.name } });
  const headingRef = useCombinedRefs(setDraggableNodeRef, setHeadingRef);
  return <section ref={setDroppableNodeRef} className="fin-edit-group" data-picked={picked?.kind === 'group' && picked.id === group.id} data-placeholder={isDragging} data-drop-target={picked?.kind === 'item' && isOver} style={{ transform: CSS.Translate.toString(collapsed ? transform : null), transition: sortableTransition }} aria-label={group.name}>
    <div className="fin-group-head" ref={headingRef}>
      {rename ? <div className="fin-group-rename"><input autoFocus readOnly={saving} aria-label="Group name" aria-invalid={!!renameError} maxLength={60} value={rename.value} onFocus={event => event.currentTarget.select()} onChange={event => onRenameValue(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); onRenameSave(); } if (event.key === 'Escape') onRenameCancel(); }}/><button aria-label="Apply group name" disabled={saving} onClick={onRenameSave}><Check size={14}/></button><button aria-label="Cancel renaming" disabled={saving} onClick={onRenameCancel}><X size={14}/></button>{onRemove && <button className="fin-remove-group" disabled={saving} onClick={onRemove}>Remove group</button>}{renameError && <p className="fin-group-error" role="alert">{renameError}</p>}</div>
        : <><button className="fin-group-title" ref={setActivatorNodeRef} {...attributes} {...listeners} data-group-title={group.id} aria-expanded={!collapsed} aria-controls={`fin-group-items-${group.id}`} aria-pressed={picked?.kind === 'group' && picked.id === group.id} aria-describedby="fin-drag-instructions" onKeyDown={event => onKeyMove(event, { kind: 'group', id: group.id, name: group.name })}>{group.name}<span>{items.length}</span></button><button className="fin-rename-group" aria-label={`Rename ${group.name}`} disabled={disabled || !!picked} onClick={onRename}><Pencil size={13}/></button></>}
    </div>
    <div className="fin-group-body" id={`fin-group-items-${group.id}`} hidden={collapsed}>
      <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
        {items.map(item => <EditableItem key={item.id} item={item} row={rows.get(item.id)} group={group} disabled={disabled || collapsed} reduced={reduced} picked={picked} onKeyMove={onKeyMove}/>)}
      </SortableContext>
      {!items.length && <div className="fin-group-empty">{picked?.kind === 'item' ? 'Drop payment here' : 'No payments in this group'}</div>}
    </div>
  </section>;
}
function EditableItem({ item, row, group, disabled, reduced, picked, onKeyMove }: { item: PaymentItem; row?: PaymentPresentationRow; group: PaymentGroup; disabled: boolean; reduced: boolean; picked: Picked | null; onKeyMove: GroupProps['onKeyMove'] }) {
  const { attributes, listeners, setNodeRef, transform, transition: sortableTransition, isDragging } = useSortable({ id: item.id, data: { kind: 'item', identity: item.id, groupId: group.id, name: item.name }, disabled, transition: reduced ? null : transition, animateLayoutChanges: animation });
  return <button ref={setNodeRef} className="fin-edit-row" {...attributes} {...listeners} data-payment-item={item.id} aria-pressed={picked?.kind === 'item' && picked.id === item.id} data-picked={picked?.kind === 'item' && picked.id === item.id} data-placeholder={isDragging} data-status={row?.status} data-direction={row?.direction} aria-describedby="fin-drag-instructions" onKeyDown={event => onKeyMove(event, { kind: 'item', id: item.id, name: item.name })} style={{ transform: CSS.Transform.toString(transform), transition: sortableTransition }}><PaymentRowContent name={item.name} row={row} editing/></button>;
}
