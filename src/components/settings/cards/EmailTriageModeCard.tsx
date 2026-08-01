import { useEffect, useState } from "react";
import { Bot, PauseCircle, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { getTriageCacheStats } from "@/api";
import { FieldHint, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { StoredEmailTriageMode, TriageCacheStatsResponse } from "../../../../shared/types/settings";

const MODE_OPTIONS = [
  {
    value: "auto",
    label: "Auto",
    action: "Auto",
    description: "Production runs models. Local development skips them.",
    icon: SlidersHorizontal,
  },
  {
    value: "real",
    label: "Real",
    action: "Use real",
    description: "Run deterministic rules and configured triage models.",
    icon: ShieldCheck,
  },
  {
    value: "no_model",
    label: "No model",
    action: "Use no model",
    description: "Surface incoming mail for review without model calls.",
    icon: Bot,
  },
  {
    value: "paused",
    label: "Paused",
    action: "Pause",
    description: "Keep syncing and queue triage work without draining it.",
    icon: PauseCircle,
  },
] as const;

function labelForMode(value: StoredEmailTriageMode) {
  return MODE_OPTIONS.find((option) => option.value === value)?.label || "Auto";
}

function resolveAutoEffectiveMode() {
  return import.meta.env.PROD ? "real" : "no_model";
}

function effectiveModeForStoredMode(storedMode: StoredEmailTriageMode) {
  if (storedMode === "auto") return resolveAutoEffectiveMode();
  return storedMode;
}

function TriageCacheGlance({ stats, loading, error }: { stats: TriageCacheStatsResponse | null; loading: boolean; error: boolean }) {
  const calls = Number(stats?.openaiCalls || 0);
  const windowDays = Number(stats?.windowDays || 7);
  const detail = error
    ? "Cache stats unavailable."
    : loading
      ? "Loading recent cache usage."
      : calls
        ? `${calls} OpenAI ${calls === 1 ? "call" : "calls"} in ${windowDays} days`
        : `No OpenAI calls in ${windowDays} days`;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="text-[11px] text-muted-foreground/75">
          {detail}
        </div>
      </div>
      <div className="shrink-0">
        <StatusPill tone="neutral">OpenAI only</StatusPill>
      </div>
    </div>
  );
}

export default function EmailTriageModeCard({ settings, setSettings, patch }: SettingsCardStateProps) {
  const storedMode = settings?.email_triage_mode || "auto";
  const effectiveMode = effectiveModeForStoredMode(storedMode);
  const classifyReadArrivals = !!settings?.email_triage_classify_read_arrivals;
  const [cacheStats, setCacheStats] = useState<TriageCacheStatsResponse | null>(null);
  const [cacheStatsState, setCacheStatsState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    getTriageCacheStats()
      .then((stats) => {
        if (cancelled) return;
        setCacheStats(stats);
        setCacheStatsState("ready");
      })
      .catch(() => {
        if (!cancelled) setCacheStatsState("error");
      });
    return () => { cancelled = true; };
  }, []);

  function applyMode(mode: StoredEmailTriageMode) {
    const nextEffectiveMode = effectiveModeForStoredMode(mode);
    setSettings((current) => ({
      ...(current || {}),
      email_triage_mode: mode,
      email_triage_effective_mode: nextEffectiveMode,
    }));
    patch({ email_triage_mode: mode });
  }

  return (
    <SettingsCard
      title="Email Triage Automation"
      icon={<Bot size={14} />}
      description="Controls the continuous email triage worker. Sync and indexing keep running unless triage is paused."
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Email triage mode">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = storedMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => applyMode(option.value)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  active
                    ? "border-primary/30 bg-primary/[0.13] text-primary shadow-[0_0_8px_rgba(203,166,218,0.16)]"
                    : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-foreground motion-reduce:hover:translate-y-0",
                )}
              >
                <Icon size={13} />
                {option.action}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="neutral">Stored: {labelForMode(storedMode)}</StatusPill>
          <StatusPill tone={effectiveMode === "paused" ? "warning" : "accent"}>
            Effective: {labelForMode(effectiveMode)}
          </StatusPill>
        </div>

        <FieldHint>
          {MODE_OPTIONS.find((option) => option.value === effectiveMode)?.description}
        </FieldHint>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-foreground">Triage read arrivals</div>
            <FieldHint className="mt-1 max-w-[68ch]">
              After the 30-second queue window, keep mail in the normal triage pipeline even if you read it in Setpoint or at your email provider. Preflight rules still apply.
            </FieldHint>
          </div>
          <Switch
            checked={classifyReadArrivals}
            onCheckedChange={(checked) => {
              setSettings((current) => ({
                ...(current || {}),
                email_triage_classify_read_arrivals: checked,
              }));
              patch({ email_triage_classify_read_arrivals: checked });
            }}
            aria-label="Triage read arrivals"
            className="mt-0.5 hover:border-white/20 active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100"
          />
        </div>

        <TriageCacheGlance
          stats={cacheStats}
          loading={cacheStatsState === "loading"}
          error={cacheStatsState === "error"}
        />
      </div>
    </SettingsCard>
  );
}
