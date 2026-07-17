import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import SearchableDropdown from "@/components/shared/SearchableDropdown";
import { FieldHint, SectionLabel } from "@/components/settings/settings-ui";
import {
  addChip,
  optionWithStoredLabel,
  removeChip,
  targetWarning,
} from "./billPayMappingsModel";
import type { StoredActualOption } from "./billPayMappingsModel";

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-white/[0.08] bg-input-bg px-2.5 text-[13px] font-medium text-foreground outline-none transition-colors hover:border-white/[0.14] focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20";
export const MINI_ICON_BUTTON_CLASS =
  "size-7 rounded-lg border border-white/[0.08] bg-white/[0.03] text-muted-foreground transition-all hover:-translate-y-px hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-foreground active:translate-y-0 disabled:pointer-events-none disabled:opacity-40 disabled:translate-y-0";

export function ChipEditor({ label, chips, placeholder, onChange }: { label: string; chips: string[]; placeholder?: string; onChange: (chips: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const next = addChip(chips, draft);
    setDraft("");
    onChange(next);
  }

  return (
    <div className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.08] bg-input-bg px-2 py-1.5">
        {chips.map((chip, index) => (
          <span
            key={`${chip}-${index}`}
            className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/[0.09] px-2 py-0.5 text-[11px] font-medium text-primary"
          >
            {chip}
            <button
              type="button"
              className="text-primary/60 transition-colors hover:text-primary"
              onClick={() => onChange(removeChip(chips, index))}
              aria-label={`Remove ${label} ${chip}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
          onBlur={() => {
            if (draft.trim()) commitDraft();
          }}
          placeholder={chips.length ? "" : placeholder}
          className="h-6 min-w-[110px] flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/75"
        />
      </div>
    </div>
  );
}

export function TargetDropdown({ label, options, value, storedLabel, missingLabel, placeholder, onChange }: {
  label: string;
  options: StoredActualOption[];
  value?: string;
  storedLabel?: string;
  missingLabel: string;
  placeholder?: string;
  onChange: (id: string, name: string) => void;
}) {
  const displayOptions = optionWithStoredLabel(options, value, storedLabel, label);
  const warning = targetWarning(options, value, storedLabel, missingLabel);

  return (
    <div className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <SearchableDropdown
          ariaLabel={label}
          options={displayOptions}
          value={value || ""}
          onChange={(nextId) => {
            const selected = options.find((option) => option.id === nextId);
            onChange(nextId, selected?.name || storedLabel || "");
          }}
          placeholder={placeholder}
        />
        {value ? (
          <button
            type="button"
            className={MINI_ICON_BUTTON_CLASS}
            onClick={() => onChange("", "")}
            aria-label={`Clear ${label}`}
          >
            <X size={13} className="mx-auto" />
          </button>
        ) : null}
      </div>
      {warning ? <FieldHint className="mt-1 text-warning">{warning}</FieldHint> : null}
    </div>
  );
}

export function MappingSelect({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <div className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={SELECT_CLASS}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ReorderButtons({ label, index, count, onMove }: { label: string; index: number; count: number; onMove: (direction: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={MINI_ICON_BUTTON_CLASS}
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={`Move ${label} up`}
      >
        <ArrowUp size={13} className="mx-auto" />
      </button>
      <button
        type="button"
        className={MINI_ICON_BUTTON_CLASS}
        disabled={index >= count - 1}
        onClick={() => onMove(1)}
        aria-label={`Move ${label} down`}
      >
        <ArrowDown size={13} className="mx-auto" />
      </button>
    </div>
  );
}
