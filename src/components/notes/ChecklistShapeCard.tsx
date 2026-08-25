import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { HTMLContainer, type Editor } from "tldraw";
import {
  CHECKLIST_SHAPE_TYPE,
  addChecklistItem,
  createChecklistItem,
  getChecklistMinHeight,
  getChecklistMinHeightForItems,
  moveChecklistItem,
  removeChecklistItem,
  updateChecklistItem,
  type ChecklistItem,
  type ChecklistShape,
} from "./checklistShapeModel";

function stopCanvasPointer(event: PointerEvent<HTMLElement>): void {
  event.stopPropagation();
}

function stopCanvasKeyboard(event: KeyboardEvent<HTMLElement>): void {
  event.stopPropagation();
}

function CheckmarkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.2 8.2 3 3.1 6.6-6.7" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4.5 4.5 7 7m0-7-7 7" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.25 4.25h.01m-.01 3.75h.01m-.01 3.75h.01m5.49-7.5h.01M10.75 8h.01m-.01 3.75h.01" />
    </svg>
  );
}

interface PointerDragState {
  itemId: string;
  pointerId: number;
  startY: number;
  offsetY: number;
  rowHeight: number;
  items: ChecklistItem[];
  started: boolean;
  lastClientY: number;
}

export function ChecklistShapeCard({ editor, shape }: { editor: Editor; shape: ChecklistShape }) {
  const inputRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const dragHandleRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragPreviewItems, setDragPreviewItems] = useState<ChecklistItem[] | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const prefersReducedMotion = useReducedMotion();
  const renderedItems = dragPreviewItems ?? shape.props.items;
  const completedCount = shape.props.items.filter((item) => item.checked).length;

  const updateShape = useCallback((props: Partial<ChecklistShape["props"]>) => {
    editor.updateShape({ id: shape.id, type: CHECKLIST_SHAPE_TYPE, props });
  }, [editor, shape.id]);

  const focusItem = (itemId: string) => {
    requestAnimationFrame(() => {
      const input = inputRefs.current.get(itemId);
      input?.focus();
      input?.select();
    });
  };

  useLayoutEffect(() => {
    inputRefs.current.forEach((input) => {
      input.style.height = "0px";
      input.style.height = `${input.scrollHeight}px`;
    });
    const measuredHeight = (contentRef.current?.scrollHeight ?? 0) + 28;
    const requiredHeight = Math.max(
      measuredHeight,
      getChecklistMinHeightForItems(shape.props.items, shape.props.w),
    );
    if (requiredHeight > shape.props.h + 1) updateShape({ h: Math.ceil(requiredHeight) });
  }, [shape.props.h, shape.props.items, shape.props.w, updateShape]);

  useLayoutEffect(() => {
    const drag = pointerDragRef.current;
    if (!drag?.started) return;
    const bounds = rowRefs.current.get(drag.itemId)?.getBoundingClientRect();
    if (!bounds) return;
    setDragOffsetY(drag.lastClientY - drag.offsetY - bounds.top);
  }, [dragPreviewItems]);

  const addItem = (afterId: string | null) => {
    const item = createChecklistItem();
    const items = addChecklistItem(shape.props.items, afterId, item);
    editor.markHistoryStoppingPoint("add checklist item");
    updateShape({ items, h: Math.max(shape.props.h, getChecklistMinHeight(items.length)) });
    focusItem(item.id);
  };

  const removeItem = (itemId: string) => {
    const index = shape.props.items.findIndex((item) => item.id === itemId);
    const items = removeChecklistItem(shape.props.items, itemId);
    if (items.length === shape.props.items.length) return;
    const focusTarget = items[Math.max(0, Math.min(index - 1, items.length - 1))];
    editor.markHistoryStoppingPoint("remove checklist item");
    updateShape({ items });
    if (focusTarget) focusItem(focusTarget.id);
  };

  const toggleItem = (item: ChecklistItem) => {
    editor.markHistoryStoppingPoint("toggle checklist item");
    updateShape({ items: updateChecklistItem(shape.props.items, item.id, { checked: !item.checked }) });
  };

  const announceReorder = (items: ChecklistItem[], itemId: string) => {
    const movedItem = items.find((item) => item.id === itemId);
    setReorderAnnouncement(
      `${movedItem?.text || "Checklist item"} moved to position ${items.findIndex((item) => item.id === itemId) + 1} of ${items.length}.`,
    );
  };

  const reorderItem = (itemId: string, targetId: string, edge: "before" | "after") => {
    const items = moveChecklistItem(shape.props.items, itemId, targetId, edge);
    if (items.every((item, index) => item.id === shape.props.items[index]?.id)) return;
    editor.markHistoryStoppingPoint("reorder checklist item");
    updateShape({ items });
    announceReorder(items, itemId);
  };

  const startPointerDrag = (event: PointerEvent<HTMLButtonElement>, item: ChecklistItem) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    const row = rowRefs.current.get(item.id);
    const bounds = row?.getBoundingClientRect();
    if (!bounds) return;
    pointerDragRef.current = {
      itemId: item.id,
      pointerId: event.pointerId,
      startY: event.clientY,
      offsetY: event.clientY - bounds.top,
      rowHeight: bounds.height,
      items: [...shape.props.items],
      started: false,
      lastClientY: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const movePointerDragTo = useCallback((pointerId: number, clientY: number) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    drag.lastClientY = clientY;
    if (!drag.started) {
      if (Math.abs(clientY - drag.startY) < 5) return;
      drag.started = true;
      editor.markHistoryStoppingPoint("reorder checklist item");
      setDraggedItemId(drag.itemId);
      setDragPreviewItems(drag.items);
    }

    const draggedBounds = rowRefs.current.get(drag.itemId)?.getBoundingClientRect();
    if (draggedBounds) setDragOffsetY(clientY - drag.offsetY - draggedBounds.top);

    const currentIndex = drag.items.findIndex((item) => item.id === drag.itemId);
    const draggedCenter = clientY - drag.offsetY + drag.rowHeight / 2;
    let closest: { itemId: string; edge: "before" | "after"; distance: number } | null = null;
    for (const [index, candidate] of drag.items.entries()) {
      if (candidate.id === drag.itemId) continue;
      const bounds = rowRefs.current.get(candidate.id)?.getBoundingClientRect();
      if (!bounds) continue;
      const targetCenter = bounds.top + bounds.height / 2;
      const crossesDown = index > currentIndex && draggedCenter > targetCenter;
      const crossesUp = index < currentIndex && draggedCenter < targetCenter;
      if (!crossesDown && !crossesUp) continue;
      const distance = Math.abs(draggedCenter - targetCenter);
      if (!closest || distance < closest.distance) {
        closest = { itemId: candidate.id, edge: crossesDown ? "after" : "before", distance };
      }
    }
    if (!closest) return;

    const items = moveChecklistItem(drag.items, drag.itemId, closest.itemId, closest.edge);
    if (items.every((item, index) => item.id === drag.items[index]?.id)) return;
    drag.items = items;
    setDragPreviewItems(items);
  }, [editor]);

  const finishPointerDrag = useCallback((pointerId: number, commit: boolean) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    pointerDragRef.current = null;
    const changed = !drag.items.every((item, index) => item.id === shape.props.items[index]?.id);
    if (commit && drag.started && changed) {
      updateShape({ items: drag.items });
      announceReorder(drag.items, drag.itemId);
    }
    setDragPreviewItems(null);
    setDragOffsetY(0);
    setDraggedItemId(null);
    const dragHandle = dragHandleRefs.current.get(drag.itemId);
    if (dragHandle?.hasPointerCapture?.(pointerId)) {
      dragHandle.releasePointerCapture(pointerId);
    }
  }, [shape.props.items, updateShape]);

  const movePointerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    movePointerDragTo(event.pointerId, event.clientY);
  };

  const completePointerDrag = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    finishPointerDrag(event.pointerId, commit);
  };

  useEffect(() => {
    const handleWindowPointerMove = (event: globalThis.PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dragHandle = dragHandleRefs.current.get(drag.itemId);
      if (event.target instanceof Node && dragHandle?.contains(event.target)) return;
      movePointerDragTo(event.pointerId, event.clientY);
    };
    const handleWindowPointerUp = (event: globalThis.PointerEvent) => {
      finishPointerDrag(event.pointerId, true);
    };
    const handleWindowPointerCancel = (event: globalThis.PointerEvent) => {
      finishPointerDrag(event.pointerId, false);
    };

    window.addEventListener("pointermove", handleWindowPointerMove, true);
    window.addEventListener("pointerup", handleWindowPointerUp, true);
    window.addEventListener("pointercancel", handleWindowPointerCancel, true);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove, true);
      window.removeEventListener("pointerup", handleWindowPointerUp, true);
      window.removeEventListener("pointercancel", handleWindowPointerCancel, true);
    };
  }, [finishPointerDrag, movePointerDragTo]);

  const moveItemByOffset = (item: ChecklistItem, offset: -1 | 1) => {
    const index = shape.props.items.findIndex((candidate) => candidate.id === item.id);
    const target = shape.props.items[index + offset];
    if (!target) return;
    reorderItem(item.id, target.id, offset < 0 ? "before" : "after");
    requestAnimationFrame(() => dragHandleRefs.current.get(item.id)?.focus());
  };

  const handleItemKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, item: ChecklistItem) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      addItem(item.id);
    } else if (event.key === "Backspace" && item.text.length === 0 && shape.props.items.length > 1) {
      event.preventDefault();
      removeItem(item.id);
    }
  };

  return (
    <HTMLContainer
      id={shape.id}
      className="setpoint-checklist"
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div ref={contentRef} className="setpoint-checklist__content">
        <div className="setpoint-checklist__title-row">
          <input
            className="setpoint-checklist__title"
            value={shape.props.title}
            placeholder="Untitled checklist"
            aria-label="Checklist title"
            spellCheck
            onPointerDown={stopCanvasPointer}
            onFocus={() => editor.markHistoryStoppingPoint("edit checklist title")}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                const firstItem = shape.props.items[0];
                if (firstItem) focusItem(firstItem.id);
              }
            }}
            onChange={(event) => updateShape({ title: event.currentTarget.value })}
          />
          <span
            className="setpoint-checklist__count"
            aria-label={`${completedCount} of ${shape.props.items.length} complete`}
          >
            {completedCount}/{shape.props.items.length}
          </span>
        </div>
        <div className="setpoint-checklist__items" role="list" aria-label={shape.props.title || "Checklist items"}>
          {renderedItems.map((item) => {
            const isDragged = draggedItemId === item.id;
            return (
              <motion.div
                ref={(element) => {
                  if (element) rowRefs.current.set(item.id, element);
                  else rowRefs.current.delete(item.id);
                }}
                key={item.id}
                className={`setpoint-checklist__row-slot${isDragged ? " setpoint-checklist__row-slot--active" : ""}`}
                layout={prefersReducedMotion || isDragged ? false : "position"}
                transition={{ layout: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } }}
                role="listitem"
              >
                <motion.div
                  className={[
                    "setpoint-checklist__row",
                    item.checked ? "setpoint-checklist__row--checked" : "",
                    isDragged ? "setpoint-checklist__row--dragging" : "",
                  ].filter(Boolean).join(" ")}
                  animate={{
                    y: isDragged ? dragOffsetY : 0,
                    scale: isDragged && !prefersReducedMotion ? 1.018 : 1,
                  }}
                  transition={{
                    y: { duration: 0 },
                    scale: { duration: prefersReducedMotion ? 0 : 0.12, ease: [0.16, 1, 0.3, 1] },
                  }}
                >
                  <button
                    ref={(element) => {
                      if (element) dragHandleRefs.current.set(item.id, element);
                      else dragHandleRefs.current.delete(item.id);
                    }}
                    type="button"
                    className="setpoint-checklist__drag"
                    aria-label={`Reorder ${item.text || "empty item"}. Hold Alt and press Arrow Up or Arrow Down to move it.`}
                    onPointerDown={(event) => startPointerDrag(event, item)}
                    onPointerMove={movePointerDrag}
                    onPointerUp={(event) => completePointerDrag(event, true)}
                    onPointerCancel={(event) => completePointerDrag(event, false)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                      event.preventDefault();
                      moveItemByOffset(item, event.key === "ArrowUp" ? -1 : 1);
                    }}
                  >
                    <GripIcon />
                  </button>
                  <button
                    type="button"
                    className="setpoint-checklist__check"
                    role="checkbox"
                    aria-checked={item.checked}
                    aria-label={`${item.checked ? "Mark incomplete" : "Mark complete"}: ${item.text || "empty item"}`}
                    onPointerDown={stopCanvasPointer}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === " " || event.key === "Enter") {
                        event.preventDefault();
                        toggleItem(item);
                      }
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleItem(item);
                    }}
                  >
                    {item.checked ? <CheckmarkIcon /> : null}
                  </button>
                  <textarea
                    ref={(element) => {
                      if (element) inputRefs.current.set(item.id, element);
                      else inputRefs.current.delete(item.id);
                    }}
                    className="setpoint-checklist__item-input"
                    value={item.text}
                    rows={1}
                    placeholder="Add an item"
                    aria-label="Checklist item"
                    spellCheck
                    onPointerDown={stopCanvasPointer}
                    onFocus={() => editor.markHistoryStoppingPoint("edit checklist item")}
                    onKeyDown={(event) => handleItemKeyDown(event, item)}
                    onChange={(event) => updateShape({
                      items: updateChecklistItem(shape.props.items, item.id, { text: event.currentTarget.value }),
                    })}
                  />
                  <button
                    type="button"
                    className="setpoint-checklist__remove"
                    aria-label={`Remove ${item.text || "empty item"}`}
                    disabled={shape.props.items.length <= 1}
                    onPointerDown={stopCanvasPointer}
                    onKeyDown={stopCanvasKeyboard}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeItem(item.id);
                    }}
                  >
                    <RemoveIcon />
                  </button>
                </motion.div>
              </motion.div>
            );
          })}
        </div>
        <span className="sr-only" role="status" aria-live="polite">{reorderAnnouncement}</span>
        <button
          type="button"
          className="setpoint-checklist__add"
          onPointerDown={stopCanvasPointer}
          onKeyDown={stopCanvasKeyboard}
          onClick={(event) => {
            event.stopPropagation();
            addItem(shape.props.items[shape.props.items.length - 1]?.id ?? null);
          }}
        >
          <PlusIcon /> Add item
        </button>
      </div>
    </HTMLContainer>
  );
}
