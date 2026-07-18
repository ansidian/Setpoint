import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TABS } from "@/components/settings/settings-core";
import type { SettingsTab } from "@/components/settings/settings-core";
import type { SettingsSaveStatus } from "@/hooks/settings/useSettingsPage";

const FIELD_LABEL_CLASS =
  "mb-1.5 block text-[11px] tracking-[1.5px] uppercase text-muted-foreground font-medium";
const FIELD_HINT_CLASS = "text-[11px] leading-relaxed text-muted-foreground/75";

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
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[1.5px] uppercase",
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

export function SettingsCard({ title, icon, description, children, headerAction, className }: {
  title: ReactNode;
  icon: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  headerAction?: ReactNode;
  className?: string;
}) {
  return (
    <section
      data-settings-section=""
      className={cn(
        "border-t border-white/[0.06] py-5 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-primary/80">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] tracking-[2.5px] uppercase text-muted-foreground font-semibold">
                {title}
              </div>
              {description ? (
                <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-muted-foreground/75">
                  {description}
                </p>
              ) : null}
            </div>
            {headerAction}
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
    <section className="animate-pulse border-t border-white/[0.06] py-5 first:border-t-0 first:pt-0">
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
    <div className="relative isolate min-h-screen px-4 py-4 text-foreground sm:px-6 sm:py-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at top, var(--sp-page), var(--sp-deep) 60%)" }}
      />

      <div className="mx-auto max-w-[1140px]">
        <header className="mb-8 flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link
                to="/"
                className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground/75 transition-colors no-underline hover:border-white/[0.1] hover:bg-white/[0.04] hover:text-foreground"
              >
                <ChevronLeft size={14} />
                Dashboard
              </Link>
              <div className="text-[11px] tracking-[2.5px] uppercase text-muted-foreground font-semibold">
                Workspace Preferences
              </div>
              <h1 className="ea-display mt-1 text-[32px] leading-none font-normal text-foreground">
                Settings
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground/75">
                Manage the accounts, automation, and AI behavior that power your daily dashboard.
              </p>
            </div>
            <div className="shrink-0">
              {headerAction}
            </div>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="md:sticky md:top-6 md:self-start">
            <div className="border-t border-white/[0.06] pt-3 md:border-t-0 md:border-l md:pl-3 md:pt-0">
              <div className="px-2 pb-2 text-[11px] tracking-[2.5px] uppercase text-muted-foreground font-semibold">
                Sections
              </div>
              <div
                role="tablist"
                aria-label="Settings sections"
                className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0"
              >
                {TABS.map((tab) => {
                  const isSelected = activeTab === tab.id;
                  const className = cn(
                    "rounded-lg border px-3 py-2 text-left text-[13px] font-medium whitespace-nowrap transition-all",
                    isSelected
                      ? "border-primary/20 bg-primary/[0.12] text-primary shadow-[0_0_8px_rgba(203,166,218,0.18)]"
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

          <div className="min-w-0" role="tabpanel" aria-label={activeTabMeta?.label}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
