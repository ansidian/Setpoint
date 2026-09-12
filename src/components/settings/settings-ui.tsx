import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check, AlertCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TABS } from "@/components/settings/settings-core";
import type { SettingsTab } from "@/components/settings/settings-core";
import type { SettingsSaveStatus } from "@/hooks/settings/useSettingsPage";

const FIELD_LABEL_CLASS =
  "mb-1.5 block text-[12px] font-medium text-foreground";
const FIELD_HINT_CLASS = "max-w-[70ch] text-[12px] leading-relaxed text-muted-foreground";

const STATUS_TONE_CLASSES = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground/80",
  accent: "border-primary/20 bg-primary/[0.1] text-primary",
  success: "border-[var(--sp-green)]/20 bg-[var(--sp-green)]/10 text-[var(--sp-green)]",
  warning: "border-[var(--sp-cream)]/20 bg-[var(--sp-cream)]/10 text-[var(--sp-cream)]",
  danger: "border-[var(--sp-rose)]/20 bg-[var(--sp-rose)]/10 text-[var(--sp-rose)]",
};

export type StatusTone = keyof typeof STATUS_TONE_CLASSES;

export function StatusPill({ tone = "neutral", className, children }: { tone?: StatusTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[1.5px] uppercase",
        STATUS_TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function SaveStatus({ status }: { status: SettingsSaveStatus }) {
  if (status === "saving") {
    return (
      <StatusPill tone="neutral">
        <Loader2 size={11} className="animate-spin" />
        Saving
      </StatusPill>
    );
  }
  if (status === "saved") {
    return (
      <StatusPill tone="success">
        <Check size={11} />
        Saved
      </StatusPill>
    );
  }
  if (status === "error") {
    return (
      <StatusPill tone="danger">
        <AlertCircle size={11} />
        Save failed
      </StatusPill>
    );
  }
  return <StatusPill tone="neutral">Auto-save on</StatusPill>;
}

export function SectionLabel({ children, className, htmlFor }: { children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label className={cn(FIELD_LABEL_CLASS, className)} htmlFor={htmlFor}>
      {children}
    </label>
  );
}

export function FieldHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn(FIELD_HINT_CLASS, className)}>
      {children}
    </p>
  );
}

export function SettingsNotice({ id, title, tone = "warning", children, className }: {
  id?: string;
  title: string;
  tone?: "warning" | "danger" | "neutral";
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "danger" ? AlertCircle : tone === "warning" ? AlertTriangle : Info;
  return (
    <div id={id} role={tone === "danger" ? "alert" : "status"} className={cn(
      "flex items-start gap-2.5 rounded-md border p-3 text-[12px] leading-relaxed",
      STATUS_TONE_CLASSES[tone], className,
    )}>
      <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <div className="mt-1 max-w-[70ch] break-words">{children}</div>
      </div>
    </div>
  );
}

export function SettingsCard({ id, ready = true, title, icon, description, children, headerAction, className }: {
  id?: string;
  ready?: boolean;
  title: ReactNode;
  icon: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  headerAction?: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-labelledby={id ? `${id}-title` : undefined}
      aria-busy={id && !ready ? true : undefined}
      data-settings-section=""
      data-settings-target-ready={id ? String(ready) : undefined}
      className={cn(
        "scroll-mt-6 border-t border-white/[0.12] py-7 outline-none first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="mb-4 flex items-start gap-3">
        <div aria-hidden="true" className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <h2 id={id ? `${id}-title` : undefined} className="text-[15px] leading-6 font-semibold text-foreground">
                {title}
              </h2>
              {description ? (
                <p className="mt-1 max-w-[70ch] text-[12px] leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {headerAction ? (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {headerAction}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="pl-0 sm:pl-8">
        {children}
      </div>
    </section>
  );
}

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <section className="animate-pulse border-t border-white/[0.12] py-7 first:border-t-0 first:pt-0 motion-reduce:animate-none">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 size-5 rounded bg-white/[0.06]" />
        <div className="min-w-0 flex-1">
          <div className="h-3 w-36 rounded bg-white/[0.06]" />
          <div className="mt-2 h-2 w-64 max-w-full rounded bg-white/[0.04]" />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:pl-8">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className="h-8 rounded-md bg-white/[0.04]"
            style={{ width: `${70 + (index % 3) * 10}%` }}
          />
        ))}
      </div>
    </section>
  );
}

// WAI-ARIA tabs pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/):
// activation-follows-focus roving tabindex, same as ShellTabs. The strip is a
// row on phones but becomes a vertical column at the `md:` breakpoint (see the
// `md:flex-col` class below), so ArrowUp/ArrowDown are wired alongside
// ArrowLeft/ArrowRight rather than picking one axis.
export function SettingsLayout({ activeTab, onTabChange, headerAction, children }: {
  activeTab: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const ids = TABS.map((tab) => tab.id);
    const currentIndex = ids.indexOf(activeTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % ids.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + ids.length) % ids.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = ids.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    const nextId = ids[nextIndex]!;
    onTabChange?.(nextId);
    tabRefs.current[nextId]?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="settings-header shrink-0 border-b border-white/[0.08] px-4 py-5 pr-16 sm:px-6 sm:pr-16">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 id="settings-heading" className="text-xl font-semibold leading-tight">Settings</h1>
            {headerAction}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Connections, automation, finance, and owner security.
          </p>
        </header>

        <div className="settings-body grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 p-4 md:grid-cols-[180px_minmax(0,1fr)] md:grid-rows-1 md:gap-6 md:p-6">
          <nav className="min-w-0">
            <div className="border-t border-white/[0.06] pt-3 md:border-t-0 md:border-l md:pl-3 md:pt-0">
              <div className="px-2 pb-2 text-[11px] tracking-[2.5px] uppercase text-muted-foreground font-semibold">
                Sections
              </div>
              <div
                role="tablist"
                aria-label="Settings sections"
                className="grid grid-cols-4 gap-1 md:flex md:flex-col"
              >
                {TABS.map((tab) => {
                  const isSelected = activeTab === tab.id;
                  const className = cn(
                    "min-h-11 rounded-lg border px-1 py-2 text-center text-[11px] font-medium whitespace-nowrap md:min-h-0 md:px-3 md:text-left md:text-[13px] transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-safe:hover:-translate-y-px motion-safe:focus-visible:-translate-y-px active:translate-y-px motion-reduce:transition-none motion-reduce:transform-none",
                    isSelected
                      ? "border-primary/20 bg-primary/[0.12] text-primary"
                      : "border-transparent text-muted-foreground hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-foreground"
                  );

                  if (!onTabChange) {
                    return (
                      <div
                        key={tab.id}
                        role="tab"
                        aria-disabled="true"
                        aria-selected={isSelected}
                        className={className}
                      >
                        {tab.label}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={tab.id}
                      ref={(el) => { tabRefs.current[tab.id] = el; }}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      onClick={() => onTabChange(tab.id)}
                      onKeyDown={handleTabKeyDown}
                      className={className}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain pr-2" role="tabpanel" aria-label={activeTabMeta?.label}>
            <div className="settings-content">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
