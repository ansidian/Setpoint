import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import SearchableDropdown from "../../shared/SearchableDropdown";
import type { TodoistLabel, TodoistPriority, TodoistProject } from "../../../../shared/types/tasks";

export function PriorityIndicator({ level }: { level: Exclude<TodoistPriority, null> }) {
  const colors = {
    1: "var(--sp-rose)",
    2: "var(--sp-cream)",
    3: "var(--sp-blue)",
    4: "var(--sp-subtext)",
  };
  const color = colors[level];
  const litCount = 5 - level;
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      {[1, 2, 3, 4].map((index) => (
        <span
          key={index}
          style={{
            width: 3,
            height: 10,
            borderRadius: 2,
            background: color,
            opacity: index <= litCount ? 1 : 0.22,
          }}
        />
      ))}
      <span style={{ color, marginLeft: 4, fontSize: 11, fontWeight: 600 }}>
        P{level}
      </span>
    </span>
  );
}

export function TokenAutocomplete({
  cursorPos,
  input,
  items,
  type,
  onSelect,
}: {
  cursorPos: number;
  input: string;
  items: Array<TodoistProject | TodoistLabel>;
  type: "project" | "label";
  onSelect: (item: TodoistProject | TodoistLabel, triggerIdx: number, cursorPos: number) => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const trigger = type === "project" ? "#" : "@";
  const textBeforeCursor = input.slice(0, cursorPos);
  const triggerIdx = textBeforeCursor.lastIndexOf(trigger);
  const fragment = triggerIdx >= 0 ? textBeforeCursor.slice(triggerIdx + 1) : null;
  const isActive = fragment !== null && !/\s/.test(fragment);

  const filtered = useMemo(() => {
    if (!isActive) return [];
    const query = fragment.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().startsWith(query)).slice(0, 6);
  }, [fragment, isActive, items]);

  const safeIdx = filtered.length ? Math.min(activeIdx, filtered.length - 1) : 0;

  useEffect(() => {
    if (!filtered.length) return undefined;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIdx((index) => (index + 1) % filtered.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIdx((index) => (index - 1 + filtered.length) % filtered.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        if (filtered[safeIdx]) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(filtered[safeIdx], triggerIdx, cursorPos);
        }
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [cursorPos, filtered, onSelect, safeIdx, triggerIdx]);

  if (!isActive || !filtered.length) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        marginTop: 4,
        background: "var(--sp-panel)",
        border: "1px solid rgba(205,214,244,0.12)",
        borderRadius: 8,
        maxHeight: 160,
        overflowY: "auto",
        zIndex: 20,
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
      }}
    >
      <div
        style={{
          padding: "4px 8px 2px",
          fontSize: 10,
          color: "var(--color-text-faint)",
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}
      >
        {type === "project" ? "Projects" : "Labels"}
      </div>
      {filtered.map((item, index) => (
        <div
          key={item.id}
          role="button"
          tabIndex={-1}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(item, triggerIdx, cursorPos);
          }}
          onMouseEnter={() => setActiveIdx(index)}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            cursor: "pointer",
            color: type === "project" ? "var(--sp-accent)" : "var(--sp-teal)",
            background: index === safeIdx ? "rgba(205,214,244,0.06)" : "transparent",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {type === "project" && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: item.color || "rgba(205,214,244,0.3)",
              }}
            />
          )}
          {item.name}
        </div>
      ))}
    </div>
  );
}

export function LabelPicker({ labels, selected, onChange }: {
  labels: TodoistLabel[];
  selected: TodoistLabel[];
  onChange: (labels: TodoistLabel[]) => void;
}) {
  const options = [...labels, ...selected.filter(label => !labels.some(option => option.id === label.id))];
  return (
    <div className="w-full min-w-0">
      <SearchableDropdown
        multiple
        ariaLabel="Labels"
        placeholder="Choose labels"
        options={options}
        value={selected.map(label => label.id)}
        onChange={ids => onChange(options.filter(label => ids.includes(label.id)))}
      />
    </div>
  );
}

export function RemoveLabelButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove label ${name}`}
      onClick={onRemove}
      className="inline-flex size-5 max-[600px]:size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-current transition-[background-color,transform] duration-[var(--sp-motion-fast)] hover:bg-white/10 hover:-translate-y-px focus-visible:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-px active:bg-white/15 motion-reduce:transition-none motion-reduce:transform-none"
    >
      <X size={12} aria-hidden />
    </button>
  );
}
