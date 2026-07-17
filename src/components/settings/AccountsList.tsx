import { useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, GripVertical } from "lucide-react";
import { Icon } from "@/lib/Icon";
import { ACCOUNT_ICON_OPTIONS } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateAccount, reorderAccounts } from "../../api";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type { AccountSummary } from "../../../shared/types/accounts";

interface AccountsListProps {
  accounts: AccountSummary[];
  setAccounts: Dispatch<SetStateAction<AccountSummary[]>>;
  onRemove: (id: string) => Promise<unknown> | unknown;
  onReconnectGmail?: () => unknown;
  onReconnectICloud?: (email: string) => unknown;
}
interface AccountRowProps extends AccountsListProps { acc: AccountSummary }

const COLOR_OPTIONS = [
  "#cba6da",
  "#b4befe",
  "#f38ba8",
  "#f5c2e7",
  "#fab387",
  "#f9e2af",
  "#a6e3a1",
  "#89dceb",
  "#89b4fa",
  "#6c7086",
];

const FIELD_LABEL_CLASS =
  "mb-1.5 block text-[11px] tracking-[1.5px] uppercase text-muted-foreground font-medium";
const SETTINGS_PRIMARY_BUTTON_CLASS =
  "border border-primary/20 bg-primary/[0.12] text-primary hover:bg-primary/[0.16] hover:border-primary/28 hover:-translate-y-px active:translate-y-0";
const SETTINGS_GHOST_BUTTON_CLASS =
  "border border-white/[0.08] bg-white/[0.03] text-foreground hover:bg-white/[0.05] hover:border-white/[0.14]";

function AccountRow({ acc, accounts, setAccounts, onRemove, onReconnectGmail, onReconnectICloud }: AccountRowProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [label, setLabel] = useState(acc.label || acc.email);
  const [color, setColor] = useState(acc.color || "#cba6da");
  const [icon, setIcon] = useState(acc.icon || (acc.type === "icloud" ? "Apple" : "Mail"));
  const [saving, setSaving] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: acc.id,
    disabled: editing || confirmingRemove,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 10 : "auto",
    cursor: editing ? "default" : isDragging ? "grabbing" : "grab",
  };

  async function handleSave() {
    setSaving(true);
    const updates = { label, color, icon };
    await updateAccount(acc.id, updates);
    setAccounts(accounts.map((a) => (a.id === acc.id ? { ...a, ...updates } : a)));
    setSaving(false);
    setEditing(false);
  }

  async function handleConfirmRemove() {
    await onRemove(acc.id);
    setConfirmingRemove(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]"
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex shrink-0 items-center gap-2 text-muted-foreground/35">
            <button
              ref={setActivatorNodeRef}
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${label}`}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/35 transition-colors hover:bg-white/[0.04] hover:text-muted-foreground/70"
            >
              <GripVertical size={14} />
            </button>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="flex size-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] transition-colors hover:border-white/[0.12] hover:bg-white/[0.05]"
              style={{ color }}
              title="Edit"
            >
              <Icon name={icon} size={16} />
            </button>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[13px] font-medium text-foreground/90">{label}</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground/75">
                <span className="size-1.5 rounded-full" style={{ background: color }} />
                {acc.type}
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground/75">
              {acc.email}
            </div>
            {acc.needs_reauth ? (
              <div className="mt-1 text-[11px] font-medium text-[var(--sp-cream)]">
                Access revoked
              </div>
            ) : null}
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {acc.needs_reauth ? (
            <Button
              size="xs"
              onClick={() => {
                if (acc.type === "icloud") {
                  onReconnectICloud?.(acc.email);
                } else {
                  onReconnectGmail?.();
                }
              }}
              className="border border-[var(--sp-cream)]/20 bg-[var(--sp-cream)]/10 text-[var(--sp-cream)] hover:bg-[var(--sp-cream)]/16 hover:border-[var(--sp-cream)]/28"
            >
              Reconnect
            </Button>
          ) : null}

          {acc.type === "gmail" ? (
            <button
              onClick={async () => {
                const newVal = !acc.calendar_enabled;
                await updateAccount(acc.id, { calendar_enabled: newVal });
                setAccounts(accounts.map((a) => (
                  a.id === acc.id ? { ...a, calendar_enabled: newVal ? 1 : 0 } : a
                )));
              }}
              title={acc.calendar_enabled ? "Calendar sync enabled" : "Calendar sync disabled"}
              aria-label={acc.calendar_enabled ? "Disable calendar sync" : "Enable calendar sync"}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                acc.calendar_enabled
                  ? "border-primary/20 bg-primary/[0.1] text-primary"
                  : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:border-white/[0.14] hover:bg-white/[0.05]"
              )}
            >
              <Calendar size={12} />
              {acc.calendar_enabled ? "Calendar on" : "Calendar off"}
            </button>
          ) : null}

          {confirmingRemove ? (
            <>
              <Button
                variant="destructive"
                size="xs"
                className="border border-destructive/20 bg-destructive/10"
                onClick={handleConfirmRemove}
              >
                Confirm remove
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className={SETTINGS_GHOST_BUTTON_CLASS}
                onClick={() => setConfirmingRemove(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="xs"
                className={SETTINGS_GHOST_BUTTON_CLASS}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? "Cancel" : "Edit"}
              </Button>
              <Button
                variant="destructive"
                size="xs"
                className="border border-destructive/20 bg-destructive/10"
                onClick={() => setConfirmingRemove(true)}
              >
                Remove
              </Button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div
          className="border-t border-white/[0.04] bg-white/[0.02] px-4 py-4"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-4">
            <div>
              <label className={FIELD_LABEL_CLASS}>Display name</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={acc.email} />
            </div>

            <div>
              <label className={FIELD_LABEL_CLASS}>Icon</label>
              <div className="flex flex-wrap gap-2">
                {ACCOUNT_ICON_OPTIONS.map((entry) => (
                  <button
                    key={entry}
                    onClick={() => setIcon(entry)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg border transition-all",
                      icon === entry
                        ? "border-primary/20 bg-primary/[0.12] text-primary"
                        : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.05]"
                    )}
                    aria-label={`Select icon ${entry}`}
                  >
                    <Icon name={entry} size={16} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={FIELD_LABEL_CLASS}>Color</label>
              <div className="flex flex-wrap items-center gap-2">
                {COLOR_OPTIONS.map((entry) => (
                  <button
                    key={entry}
                    onClick={() => setColor(entry)}
                    className="size-6 rounded-full border-2 transition-all"
                    style={{
                      background: entry,
                      borderColor: color === entry ? "#fff" : "transparent",
                      boxShadow: color === entry ? `0 0 0 2px ${entry}` : "none",
                    }}
                    aria-label={`Select color ${entry}`}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-6 w-8 cursor-pointer rounded-md border border-white/[0.08] bg-transparent"
                  title="Custom color"
                  aria-label="Pick custom color"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={saving}
                size="sm"
                className={SETTINGS_PRIMARY_BUTTON_CLASS}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={SETTINGS_GHOST_BUTTON_CLASS}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AccountsList({ accounts, setAccounts, onRemove, onReconnectGmail, onReconnectICloud }: AccountsListProps) {
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = accounts.findIndex((a) => a.id === active.id);
    const newIndex = accounts.findIndex((a) => a.id === over.id);
    const reordered = arrayMove(accounts, oldIndex, newIndex);
    setAccounts(reordered);
    await reorderAccounts(reordered.map((a) => a.id));
  }

  return (
    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={accounts.map((a) => a.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {accounts.map((acc) => (
            <AccountRow
              key={acc.id}
              acc={acc}
              accounts={accounts}
              setAccounts={setAccounts}
              onRemove={onRemove}
              onReconnectGmail={onReconnectGmail}
              onReconnectICloud={onReconnectICloud}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
