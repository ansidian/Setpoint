import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type SearchableDropdownOption = {
  id: string;
  name: string;
  content?: ReactNode;
};

type SearchableDropdownBaseProps = {
  options: SearchableDropdownOption[];
  placeholder?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  onOpen?: () => void;
  disabled?: boolean;
};

export type SearchableDropdownProps = SearchableDropdownBaseProps & ({
  multiple?: false;
  value: string | null | undefined;
  onChange: (value: string) => void;
  allowCreate?: boolean;
  onCreateNew?: (name: string) => void;
} | {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
  allowCreate?: never;
  onCreateNew?: never;
});

export default function SearchableDropdown(props: SearchableDropdownProps) {
  const { options, placeholder = "Select...", ariaLabel, ariaDescribedBy, onOpen, disabled = false } = props;
  const allowCreate = !props.multiple && props.allowCreate;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // cmdk only reveals the active result when its value changes. A new query
    // can keep that result while leaving the list at its previous scroll offset.
    const frame = requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [search]);

  const selected = props.multiple ? undefined : options.find(o => o.id === props.value);
  const displayName = props.multiple
    ? props.value.length ? `${props.value.length} selected` : null
    : selected?.name || (allowCreate && props.value && !selected ? props.value : null);
  const trimmedSearch = search.trim();
  const exactMatch = trimmedSearch && options.some(o => o.name.toLowerCase() === trimmedSearch.toLowerCase());
  const showCreateOption = allowCreate && trimmedSearch && !exactMatch;

  const handleCreate = () => {
    const name = trimmedSearch;
    if (props.multiple) return;
    if (props.onCreateNew) props.onCreateNew(name);
    else props.onChange(name);
    setOpen(false);
    setSearch("");
  };

  function selectOption(id: string) {
    if (props.multiple) {
      props.onChange(props.value.includes(id) ? props.value.filter(value => value !== id) : [...props.value, id]);
      return;
    }
    props.onChange(id);
    setOpen(false);
    setSearch("");
  }

  return (
    <div onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) onOpen?.(); else setSearch(""); }} modal={false}>
        <PopoverTrigger
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          className={cn(
            "flex min-h-9 max-[600px]:min-h-11 w-full items-center justify-between gap-2 rounded-md bg-input-bg px-2.5 py-1.5 text-left",
            "border border-white/[0.08] text-[13px] font-medium text-foreground",
            "cursor-pointer outline-none transition-[border-color,background-color,box-shadow,transform] duration-[var(--sp-motion-fast)]",
            "hover:-translate-y-px hover:border-white/[0.15] hover:bg-white/[0.03] focus-visible:-translate-y-px focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/20 active:translate-y-px",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-white/[0.08] disabled:hover:bg-input-bg disabled:active:translate-y-0",
            "motion-reduce:transition-none motion-reduce:transform-none",
          )}
        >
          <span className={cn("min-w-0 flex-1 whitespace-normal break-words font-medium", !displayName && "text-muted-foreground/75")}>
            {selected?.content ?? (displayName || placeholder)}
          </span>
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={cn("shrink-0 text-muted-foreground/40 transition-transform duration-200", open && "rotate-180")}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={16}
          sticky
          onPointerDown={(e) => e.stopPropagation()}
          className="w-[var(--anchor-width)] min-w-[min(240px,calc(100vw-32px))] max-w-[calc(100vw-32px)] rounded bg-[var(--sp-panel)] border border-white/10 p-0 shadow-lg"
        >
          {/* PopoverContent is keepMounted (shared popover.tsx default), so the
              option DOM would otherwise persist while closed. Build the Command
              body only when open and tear it down on close. */}
          {open && (
            <Command
              className="bg-transparent"
            >
              <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder={allowCreate ? "Search or type new..." : "Search..."}
              />
              <CommandList ref={listRef} aria-multiselectable={props.multiple || undefined} className="max-h-[180px] overscroll-contain">
                <CommandEmpty className="py-2 text-xs text-muted-foreground/75">No matches</CommandEmpty>
                <CommandGroup>
                  {options.map(o => (
                    <CommandItem
                      key={o.id}
                      value={`option:${o.id}`}
                      keywords={[o.name]}
                      onSelect={() => selectOption(o.id)}
                      data-checked={(props.multiple ? props.value.includes(o.id) : o.id === props.value) ? "true" : undefined}
                      {...(props.multiple ? { "aria-selected": props.value.includes(o.id) } : {})}
                      className="data-[checked=true]:hover:bg-primary/25 data-[checked=true]:data-selected:bg-primary/25 data-selected:inset-ring-1 data-selected:inset-ring-primary/40 min-h-9 max-[600px]:min-h-11 text-[13px] text-foreground cursor-pointer transition-[background-color,color,box-shadow] duration-[var(--sp-motion-fast)] active:bg-primary/20 motion-reduce:transition-none"
                    >
                      <span className="min-w-0 flex-1 whitespace-normal break-words">{o.content ?? o.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                {showCreateOption && (
                  <CommandGroup>
                    <CommandItem
                      value={`create:${trimmedSearch}`}
                      keywords={[trimmedSearch]}
                      onSelect={handleCreate}
                      className="text-primary"
                    >
                      <span className="text-sm">+</span> Create &ldquo;{trimmedSearch}&rdquo;
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
