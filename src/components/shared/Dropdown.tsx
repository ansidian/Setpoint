import { useState, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export type DropdownOption = { id: string; name: string; content?: ReactNode; disabled?: boolean };

/** Short, fixed choices. Use SearchableDropdown for long or creatable lists. */
export default function Dropdown({ options, value, onChange, ariaLabel, placeholder = 'Choose an option', disabled = false, required = false }: {
  options: DropdownOption[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.id === value);
  return <div className="shared-dropdown w-full min-w-0" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Select open={open} onOpenChange={setOpen} value={value ?? null} onValueChange={next => { if (next !== null) onChange(next); }}
      items={options.map(option => ({ value:option.id, label:option.name }))} disabled={disabled} required={required}>
      <SelectTrigger aria-label={ariaLabel} className="h-auto min-h-9 w-full rounded-md border-white/[0.08] bg-input-bg px-2.5 py-1.5 text-[13px] font-medium text-foreground transition-[border-color,background-color,box-shadow,transform] duration-[var(--sp-motion-fast)] hover:border-white/[0.15] hover:bg-white/[0.03] focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/20 active:translate-y-px disabled:hover:border-white/[0.08] disabled:hover:bg-input-bg disabled:active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none max-[600px]:min-h-11 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate">
        <SelectValue className={options.some(option => option.id === value) ? "text-foreground" : undefined} placeholder={placeholder}>{selected?.content ?? selected?.name}</SelectValue>
      </SelectTrigger>
      {/* Close synchronously: Activity can suspend exit-animation cleanup when
          switching tabs, otherwise leaving the portal above the next workspace. */}
      {open && <SelectContent onPointerDown={event => event.stopPropagation()} align="start" alignItemWithTrigger={false} className="max-h-[min(280px,var(--available-height))] min-w-0 overscroll-contain rounded-md border border-white/10 bg-[var(--sp-panel)] p-1 text-foreground ring-0 duration-[var(--sp-motion-fast)] motion-reduce:animate-none [&_[data-slot^=select-scroll]]:bg-[var(--sp-panel)]">
        {options.map(option => <SelectItem key={option.id} value={option.id} disabled={option.disabled}
          className="min-h-9 cursor-pointer px-2.5 py-2 pr-8 text-[13px] text-foreground transition-[background-color,box-shadow,transform] duration-[var(--sp-motion-fast)] hover:bg-white/[0.06] focus:bg-white/[0.06] focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground data-highlighted:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 active:bg-primary/15 data-selected:bg-primary/10 data-selected:text-primary motion-reduce:transition-none max-[600px]:min-h-11 [&>span]:whitespace-normal">
          {option.content ?? option.name}
        </SelectItem>)}
      </SelectContent>}
    </Select>
  </div>;
}
