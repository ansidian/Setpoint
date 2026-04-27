import { Link } from "react-router-dom";
import { ChevronLeft, Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TABS } from "@/components/settings/settings-core";

const FIELD_LABEL_CLASS =
  "mb-1.5 block text-[11px] tracking-[1.5px] uppercase text-muted-foreground font-medium";
const FIELD_HINT_CLASS = "text-[11px] leading-relaxed text-muted-foreground/60";

const STATUS_TONE_CLASSES = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground/80",
  accent: "border-primary/20 bg-primary/[0.1] text-primary",
  success: "border-[#a6e3a1]/20 bg-[#a6e3a1]/10 text-[#a6e3a1]",
  warning: "border-[#f9e2af]/20 bg-[#f9e2af]/10 text-[#f9e2af]",
  danger: "border-[#f38ba8]/20 bg-[#f38ba8]/10 text-[#f38ba8]",
};

export function StatusPill({ tone = "neutral", className, children }) {
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

export function SaveStatus({ status }) {
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

export function SectionLabel({ children, className }) {
  return (
    <label className={cn(FIELD_LABEL_CLASS, className)}>
      {children}
    </label>
  );
}

export function FieldHint({ children, className }) {
  return (
    <p className={cn(FIELD_HINT_CLASS, className)}>
      {children}
    </p>
  );
}

export function SettingsCard({ title, icon, description, children, headerAction, className }) {
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
                <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-muted-foreground/65">
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

export function SkeletonCard({ lines = 2 }) {
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

export function SettingsLayout({ activeTab, onTabChange, headerAction, children }) {
  return (
    <div className="relative isolate min-h-screen px-4 py-4 text-foreground sm:px-6 sm:py-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at top, #1a1a2a, #0b0b13 60%)" }}
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
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground/65">
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
              <div className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
                {TABS.map((tab) => {
                  const className = cn(
                    "rounded-lg border px-3 py-2 text-left text-[13px] font-medium whitespace-nowrap transition-all",
                    activeTab === tab.id
                      ? "border-primary/20 bg-primary/[0.12] text-primary shadow-[0_0_8px_rgba(203,166,218,0.18)]"
                      : "border-transparent text-muted-foreground hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-foreground"
                  );

                  if (!onTabChange) {
                    return (
                      <div key={tab.id} className={className}>
                        {tab.label}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onTabChange(tab.id)}
                      className={className}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          <div className="min-w-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
