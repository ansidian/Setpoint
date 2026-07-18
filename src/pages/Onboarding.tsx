import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Circle,
  ListChecks,
  RotateCw,
  SkipForward,
} from "lucide-react";
import { getCapabilities } from "../api";
import { getOnboardingProgress, updateOnboardingProgress } from "@/lib/onboardingApi";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/settings/settings-ui";
import { projectCapabilityStatus } from "@/components/settings/cards/capabilityOverviewModel";
import { ONBOARDING_STEPS, projectOnboardingChecklist } from "@/lib/onboardingModel";
import type { CapabilityStatus } from "../../shared/types/capabilities";
import type {
  OnboardingProgress,
  OnboardingProgressMutation,
  OnboardingStepId,
} from "../../shared/types/onboarding";
import { cn } from "@/lib/utils";

const SECONDARY_BUTTON = "motion-reduce:transition-none motion-reduce:transform-none";

function progressLabel(state: "pending" | "reviewed" | "completed" | "skipped") {
  if (state === "completed") return { label: "Reviewed", tone: "success" as const };
  if (state === "skipped") return { label: "Skipped", tone: "warning" as const };
  if (state === "reviewed") return { label: "In progress", tone: "accent" as const };
  return { label: "Pending", tone: "neutral" as const };
}

export default function Onboarding(): ReactElement {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityStatus[]>([]);
  const [activeId, setActiveId] = useState<OnboardingStepId>(ONBOARDING_STEPS[0]!.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function load(): Promise<void> {
    setError(null);
    try {
      const [nextProgress, status] = await Promise.all([
        getOnboardingProgress(),
        getCapabilities().catch(() => ({ generatedAt: "", capabilities: [] })),
      ]);
      setProgress(nextProgress);
      setCapabilities(status.capabilities);
      setActiveId(projectOnboardingChecklist(nextProgress).activeStepId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load onboarding");
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => { headingRef.current?.focus(); }, [activeId, progress?.status]);

  const checklist = useMemo(() => progress ? projectOnboardingChecklist(progress) : null, [progress]);
  const active = checklist?.steps.find((step) => step.id === activeId) ?? checklist?.steps[0];

  async function mutate(mutation: OnboardingProgressMutation): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateOnboardingProgress(mutation);
      setProgress(next);
      window.dispatchEvent(new CustomEvent("ea-onboarding-changed", {
        detail: { finished: next.status === "complete" },
      }));
      if (mutation.action === "complete" || mutation.action === "skip") {
        setActiveId(projectOnboardingChecklist(next).activeStepId);
      }
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not save onboarding progress");
    } finally {
      setBusy(false);
    }
  }

  function selectStep(stepId: OnboardingStepId): void {
    setActiveId(stepId);
    if (progress && !progress.steps[stepId]) void mutate({ action: "review", stepId });
  }

  if (!progress && !error) {
    return (
      <main className="flex min-h-screen items-center justify-center text-foreground" aria-label="Loading onboarding">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-primary motion-reduce:animate-none" />
      </main>
    );
  }

  if (!progress) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-foreground">
        <div className="max-w-md border-t border-white/[0.08] pt-5 text-center">
          <h1 className="text-[18px] font-semibold">Onboarding could not load</h1>
          <p role="alert" className="mt-2 text-[12px] text-[var(--sp-rose)]">{error}</p>
          <Button className={`mt-4 ${SECONDARY_BUTTON}`} onClick={() => void load()}>Try again</Button>
        </div>
      </main>
    );
  }

  if (checklist?.finished) {
    return (
      <main className="relative isolate flex min-h-screen items-center justify-center px-4 py-8 text-foreground">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--sp-page),var(--sp-deep)_60%)]" />
        <section className="w-full max-w-xl border-y border-white/[0.07] py-8 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-[var(--sp-green)]/25 bg-[var(--sp-green)]/10 text-[var(--sp-green)] motion-safe:animate-[scaleIn_240ms_cubic-bezier(0.16,1,0.3,1)]">
            <Check aria-hidden="true" size={20} />
          </div>
          <h1 ref={headingRef} tabIndex={-1} className="mt-4 text-[24px] font-semibold outline-none">Setup checklist complete</h1>
          <p className="mx-auto mt-2 max-w-[58ch] text-pretty text-[13px] leading-relaxed text-muted-foreground">
            <span className="block text-foreground">
              {checklist.completedCount === ONBOARDING_STEPS.length
                ? "You reviewed every setup option."
                : "Your setup choices are saved."}
            </span>
            Setpoint will not force this checklist open again. Capability health continues to update independently in Settings.
          </p>
          {error ? <p role="alert" className="mt-3 text-[12px] text-[var(--sp-rose)]">{error}</p> : null}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button className={SECONDARY_BUTTON} disabled={busy} onClick={() => void mutate({ action: "reopen" })}>
              <RotateCw aria-hidden="true" /> Reopen checklist
            </Button>
            <Link to="/" className={cn(buttonVariants({ variant: "secondary" }), SECONDARY_BUTTON)}>Go to dashboard</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="relative isolate min-h-screen px-4 py-5 text-foreground sm:px-6 sm:py-7">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--sp-page),var(--sp-deep)_60%)]" />
      <div className="mx-auto max-w-[1040px]">
        <header className="mb-6 flex flex-col gap-4 border-b border-white/[0.06] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link to="/" className="mb-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-muted-foreground transition-[background-color,color,transform] hover:-translate-y-px hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none">
              <ChevronLeft aria-hidden="true" size={14} /> Dashboard
            </Link>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[2px] text-muted-foreground">
              <ListChecks aria-hidden="true" size={14} /> Setup checklist
            </div>
            <h1 className="mt-1 text-balance text-[28px] font-semibold leading-tight">Choose what Setpoint can do</h1>
            <p className="mt-2 max-w-[68ch] text-pretty text-[13px] leading-relaxed text-muted-foreground">
              Every connection is optional. Review what matters now, skip the rest, and return from Settings whenever you want.
            </p>
          </div>
          <StatusPill tone="accent" className="w-fit normal-case tracking-normal">
            {checklist?.completedCount ?? 0} of {ONBOARDING_STEPS.length} reviewed
          </StatusPill>
        </header>

        <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
          <nav aria-label="Onboarding steps" className="md:sticky md:top-6 md:self-start">
            <ol className="divide-y divide-white/[0.05] border-y border-white/[0.06]">
              {checklist?.steps.map((step) => {
                const selected = step.id === active?.id;
                const state = progressLabel(step.state);
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      aria-current={selected ? "step" : undefined}
                      onClick={() => selectStep(step.id)}
                      className={`flex min-h-12 w-full items-center gap-3 px-2 py-2.5 text-left text-[12px] transition-[background-color,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 active:translate-y-px motion-reduce:transition-none motion-reduce:transform-none ${selected ? "bg-primary/[0.1] text-foreground" : "text-muted-foreground hover:bg-white/[0.035] hover:text-foreground"}`}
                    >
                      {step.state === "completed" ? <Check aria-hidden="true" size={14} className="text-[var(--sp-green)]" />
                        : step.state === "skipped" ? <SkipForward aria-hidden="true" size={14} className="text-[var(--sp-cream)]" />
                          : <Circle aria-hidden="true" size={14} className={selected ? "text-primary" : "text-muted-foreground"} />}
                      <span className="min-w-0 flex-1">{step.title}</span>
                      <span className="sr-only">{state.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {active ? (
            <section className="min-w-0 border-t border-white/[0.07] pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 ref={headingRef} tabIndex={-1} className="text-balance text-[20px] font-semibold outline-none">{active.title}</h2>
                  <p className="mt-2 max-w-[65ch] text-pretty text-[13px] leading-relaxed text-muted-foreground">{active.description}</p>
                </div>
                <StatusPill tone={progressLabel(active.state).tone} className="normal-case tracking-normal">
                  {progressLabel(active.state).label}
                </StatusPill>
              </div>

              <div className="mt-5 divide-y divide-white/[0.05] border-y border-white/[0.06]">
                {active.capabilityIds.map((capabilityId) => {
                  const capability = capabilities.find((item) => item.id === capabilityId);
                  const view = capability ? projectCapabilityStatus(capability) : null;
                  return (
                    <div key={capabilityId} className="flex min-h-12 items-center justify-between gap-3 py-2.5">
                      <span className="text-[12px] font-medium text-foreground">{capabilityId.replace(/_/g, " ")}</span>
                      <StatusPill tone={view?.tone ?? "neutral"} className="normal-case tracking-normal">{view?.label ?? "Status unavailable"}</StatusPill>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link to={active.settingsHref} className={cn(buttonVariants(), SECONDARY_BUTTON)}>{active.actionLabel}<ArrowRight aria-hidden="true" /></Link>
                <Button variant="secondary" className={SECONDARY_BUTTON} disabled={busy} onClick={() => void mutate({ action: "complete", stepId: active.id })}>Mark reviewed</Button>
                <Button variant="ghost" className={SECONDARY_BUTTON} disabled={busy} onClick={() => void mutate({ action: "skip", stepId: active.id })}>Skip for now</Button>
              </div>
              <div className="mt-7 flex flex-col gap-3 border-t border-white/[0.06] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-[54ch] text-[11px] leading-relaxed text-muted-foreground">Finish at any time. Pending and skipped capabilities remain visible in Settings without reopening this page.</p>
                <Button variant="outline" className={SECONDARY_BUTTON} disabled={busy} onClick={() => void mutate({ action: "finish" })}>Finish onboarding</Button>
              </div>
              {error ? <p role="alert" className="mt-3 text-[12px] text-[var(--sp-rose)]">{error}</p> : null}
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
