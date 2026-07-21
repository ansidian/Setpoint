import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import { FieldHint, SectionLabel } from "@/components/settings/settings-ui";
import { cn } from "@/lib/utils";
import type { SensitiveActionStepUpState } from "./sensitiveActionStepUpModel";

const BUTTON_MOTION = "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

export function SensitiveActionStepUp({
  state,
  className,
}: {
  state: SensitiveActionStepUpState;
  className?: string;
}) {
  const inputId = useId();
  if (!state.pendingLabel) return null;

  return (
    <form
      onSubmit={state.unlock}
      className={cn("rounded-lg border border-white/[0.08] bg-white/[0.025] p-3", className)}
      aria-live="polite"
    >
      <p className="max-w-[70ch] text-[11px] leading-relaxed text-foreground">
        Credential changes are locked. Confirm your current password to retry {state.pendingLabel}.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <SectionLabel htmlFor={inputId}>Current password</SectionLabel>
          <Input
            id={inputId}
            type="password"
            autoComplete="current-password"
            value={state.password}
            onChange={(event) => state.setPassword(event.target.value)}
            disabled={state.busy}
            autoFocus
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION)}
            disabled={!state.password || state.busy}
          >
            {state.busy ? "Confirming…" : "Confirm and retry"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
            disabled={state.busy}
            onClick={state.cancel}
          >
            Cancel
          </Button>
        </div>
      </div>
      <FieldHint className="mt-2">Password confirmation unlocks sensitive changes for ten minutes.</FieldHint>
      {state.error ? <div role="alert"><FieldHint className="mt-2 text-danger">{state.error}</FieldHint></div> : null}
    </form>
  );
}
