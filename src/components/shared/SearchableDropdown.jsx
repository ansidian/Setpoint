import { useState } from "react";
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

export default function SearchableDropdown({ options, value, onChange, placeholder = "Select...", allowCreate = false, onCreateNew, ariaLabel, onOpen }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = options.find(o => o.id === value);
  const displayName = selected?.name || (allowCreate && value && !selected ? value : null);
  const trimmedSearch = search.trim();
  const exactMatch = trimmedSearch && options.some(o => o.name.toLowerCase() === trimmedSearch.toLowerCase());
  const showCreateOption = allowCreate && trimmedSearch && !exactMatch;

  const handleCreate = () => {
    const name = trimmedSearch;
    if (onCreateNew) onCreateNew(name);
    else onChange(name);
    setOpen(false);
    setSearch("");
  };

  return (
    <div onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) onOpen?.(); else setSearch(""); }} modal={false}>
        <PopoverTrigger
          aria-label={ariaLabel}
          className={cn(
            "flex w-full items-center justify-between rounded bg-input-bg px-2.5 py-1.5",
            "border border-white/[0.08] text-[13px] font-medium text-foreground",
            "cursor-pointer transition-[border-color,box-shadow] duration-150",
            "hover:border-white/[0.15]"
          )}
        >
          <span className="font-medium">{displayName || placeholder}</span>
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={cn("text-muted-foreground/40 transition-transform duration-200", open && "rotate-180")}
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
          className="w-[var(--anchor-width)] rounded bg-elevated border border-white/10 p-0 shadow-modal"
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
              <CommandList className="max-h-[180px]">
                <CommandEmpty className="py-2 text-xs text-muted-foreground/50">No matches</CommandEmpty>
                <CommandGroup>
                  {options.map(o => (
                    <CommandItem
                      key={o.id}
                      value={o.name}
                      onSelect={() => { onChange(o.id); setOpen(false); setSearch(""); }}
                      data-checked={o.id === value ? "true" : undefined}
                      className="text-[13px] text-foreground/80 cursor-pointer transition-all duration-150"
                    >
                      {o.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {showCreateOption && (
                  <CommandGroup>
                    <CommandItem
                      value={trimmedSearch}
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
