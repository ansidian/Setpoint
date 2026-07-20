import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  disableInstanceCredential,
  discardInstanceCredentialPending,
  importInstanceCredentialEnvironment,
  stageInstanceCredential,
  testInstanceCredential,
  useHostInstanceCredential as restoreHostInstanceCredential,
} from "@/api";
import { isDemoMode } from "@/demo/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FieldHint,
  SectionLabel,
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import {
  credentialErrorMessage,
  credentialStatusView,
  formatCredentialTimestamp,
  pendingCredentialExpiryLabel,
} from "./coreCredentialModel";
import type { InstanceCredentialMetadata } from "../../../../shared/types/instance-credentials";
import type { SettingsCredentialMetadataProps } from "../settingsTypes";
import {
  SensitiveActionStepUp,
} from "../SensitiveActionStepUp";
import {
  isPasswordStepUpRequired,
  useSensitiveActionStepUp,
} from "../sensitiveActionStepUpModel";

export type CoreCredentialDefinition = {
  key: string;
  label: string;
  inputLabel: string;
  placeholder: string;
  help: string;
};

const BUTTON_MOTION = "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

function apiErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : null;
}

function CredentialRow({
  definition,
  metadata,
  onMetadata,
  onRefresh,
}: {
  definition: CoreCredentialDefinition;
  metadata: InstanceCredentialMetadata;
  onMetadata: (metadata: InstanceCredentialMetadata) => void;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const status = credentialStatusView(metadata);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stepUp = useSensitiveActionStepUp();
  const credentialActionLocked = Boolean(stepUp.pendingLabel);

  function restoreInputFocus() {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function performPendingTest() {
    let shouldRestoreFocus = true;
    setBusy("test");
    setMessage(null);
    setError(null);
    try {
      const result = await testInstanceCredential(definition.key);
      onMetadata(result.metadata);
      setMessage("Validated and activated. Runtime configuration is updated.");
    } catch (caught) {
      if (isPasswordStepUpRequired(caught)) {
        shouldRestoreFocus = false;
        throw caught;
      }
      setError(credentialErrorMessage(apiErrorCode(caught)));
      await onRefresh().catch(() => {});
    } finally {
      setBusy(null);
      if (shouldRestoreFocus) restoreInputFocus();
    }
  }

  async function testPending() {
    await stepUp.run(
      performPendingTest,
      `testing the ${definition.label} credential`,
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const candidate = draft;
    await stepUp.run(async () => {
      let shouldRestoreFocus = true;
      setBusy("save");
      setMessage(null);
      setError(null);
      try {
        const staged = await stageInstanceCredential(definition.key, candidate);
        setDraft("");
        onMetadata(staged);
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) {
          shouldRestoreFocus = false;
          throw caught;
        }
        setError(credentialErrorMessage(apiErrorCode(caught)));
        await onRefresh().catch(() => {});
        return;
      } finally {
        setBusy(null);
        if (shouldRestoreFocus) restoreInputFocus();
      }
      await testPending();
    }, `saving the ${definition.label} credential`);
  }

  async function runSourceAction(action: "import" | "disable" | "host") {
    await stepUp.run(async () => {
      let shouldRestoreFocus = true;
      setBusy(action);
      setMessage(null);
      setError(null);
      try {
        const updated = action === "import"
          ? await importInstanceCredentialEnvironment(definition.key)
          : action === "disable"
            ? await disableInstanceCredential(definition.key)
            : await restoreHostInstanceCredential(definition.key);
        onMetadata(updated);
        setMessage(action === "import"
          ? "Copied into encrypted Setpoint storage. The Render variable still remains. Back up EA_ENCRYPTION_KEY, remove the provider variable in Render, redeploy, then verify the provider before considering the migration complete."
          : action === "disable"
            ? "Stored and pending values removed; host fallback is disabled."
            : "Host-managed configuration is active again.");
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) {
          shouldRestoreFocus = false;
          throw caught;
        }
        setError(credentialErrorMessage(apiErrorCode(caught)));
      } finally {
        setBusy(null);
        if (shouldRestoreFocus) restoreInputFocus();
      }
    }, action === "import"
      ? `copying the ${definition.label} credential into Setpoint`
      : action === "disable"
        ? `removing the ${definition.label} credential`
        : `restoring the host-managed ${definition.label} credential`);
  }

  async function discardPending() {
    if (metadata.version === null) return;
    const expectedVersion = metadata.version;
    await stepUp.run(async () => {
      setBusy("discard");
      setMessage(null);
      setError(null);
      try {
        await discardInstanceCredentialPending(definition.key, expectedVersion);
        await onRefresh();
        setMessage("Pending candidate discarded. The active credential is unchanged.");
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setError("The pending candidate could not be discarded. The active credential is unchanged.");
        await onRefresh().catch(() => {});
      } finally {
        setBusy(null);
      }
    }, `discarding the pending ${definition.label} credential`);
  }

  const lastTest = formatCredentialTimestamp(metadata.lastTestedAt);
  const lastSuccess = formatCredentialTimestamp(metadata.lastSucceededAt);
  const lastFailure = formatCredentialTimestamp(metadata.lastFailedAt);
  const pendingExpiry = pendingCredentialExpiryLabel(metadata);
  return (
    <div className="border-t border-white/[0.05] py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-foreground">{definition.label}</div>
          <p className="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-muted-foreground">{definition.help}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <StatusPill tone={status.activeTone}>{status.activeLabel}</StatusPill>
          {status.pendingLabel ? <StatusPill tone={status.pendingTone}>{status.pendingLabel}</StatusPill> : null}
        </div>
      </div>

      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <SectionLabel htmlFor={`credential-${definition.key}`}>{definition.inputLabel}</SectionLabel>
          <Input
            ref={inputRef}
            id={`credential-${definition.key}`}
            type="password"
            autoComplete="new-password"
            value={draft}
            placeholder={definition.placeholder}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
              setMessage(null);
            }}
            disabled={Boolean(busy) || credentialActionLocked}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION)}
          disabled={!draft || Boolean(busy) || credentialActionLocked}
        >
          {busy === "save" || busy === "test" ? "Testing…" : metadata.activeConfigured ? "Test replacement" : "Test and save"}
        </Button>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {metadata.pendingConfigured ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
              disabled={Boolean(busy) || credentialActionLocked}
              onClick={testPending}
            >
              {busy === "test" ? "Testing…" : "Retest pending"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
              disabled={Boolean(busy) || credentialActionLocked || metadata.version === null}
              onClick={discardPending}
            >
              {busy === "discard" ? "Discarding…" : "Discard pending"}
            </Button>
          </>
        ) : null}
        {metadata.source === "environment" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
            disabled={Boolean(busy) || credentialActionLocked}
            onClick={() => runSourceAction("import")}
          >
            {busy === "import" ? "Copying…" : "Copy into Setpoint"}
          </Button>
        ) : null}
        {metadata.source !== "disabled" && metadata.source !== "absent" ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className={BUTTON_MOTION}
            disabled={Boolean(busy) || credentialActionLocked}
            onClick={() => setConfirmingDisable(true)}
          >
            Remove and disable
          </Button>
        ) : null}
        {metadata.source === "disabled" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
            disabled={Boolean(busy) || credentialActionLocked}
            onClick={() => runSourceAction("host")}
          >
            {busy === "host" ? "Checking host…" : "Use host value"}
          </Button>
        ) : null}
      </div>
      {confirmingDisable ? (
        <div className="mt-3 rounded-lg border border-danger/25 bg-danger/[0.05] p-3">
          <p className="max-w-[70ch] text-[11px] leading-relaxed text-foreground">
            This deletes the stored and pending {definition.label} credential and blocks host fallback. The provider will stop working until a credential is restored.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className={BUTTON_MOTION}
              disabled={Boolean(busy) || credentialActionLocked}
              onClick={() => { setConfirmingDisable(false); void runSourceAction("disable"); }}
            >
              {busy === "disable" ? "Removing…" : `Confirm remove ${definition.label} credential`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
              disabled={Boolean(busy) || credentialActionLocked}
              onClick={() => setConfirmingDisable(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <SensitiveActionStepUp state={stepUp} className="mt-3" />
      {pendingExpiry ? <FieldHint className="mt-2">{pendingExpiry}</FieldHint> : null}
      {lastTest || lastSuccess || lastFailure ? (
        <FieldHint className="mt-2">
          {[
            lastTest ? `Tested ${lastTest}` : null,
            lastSuccess ? `Last success ${lastSuccess}` : null,
            lastFailure ? `Last failure ${lastFailure}` : null,
          ].filter(Boolean).join(" · ")}
        </FieldHint>
      ) : null}
      {message ? <div role="status"><FieldHint className="mt-2 text-[var(--sp-green)]">{message}</FieldHint></div> : null}
      {error ? <div role="alert"><FieldHint className="mt-2 text-danger">{error}</FieldHint></div> : null}
    </div>
  );
}

export default function CoreProviderCredentialsCard({
  id,
  title,
  icon,
  description,
  credentials,
  credentialMetadata,
  onCredentialMetadataChange,
  onRefreshCredentialMetadata,
}: {
  id?: string;
  title: string;
  icon: ReactNode;
  description: string;
  credentials: CoreCredentialDefinition[];
} & SettingsCredentialMetadataProps) {
  const demo = isDemoMode();
  const metadata = credentialMetadata ?? [];
  const loadError = credentialMetadata === null;

  return (
    <SettingsCard
      id={id}
      ready
      title={title}
      icon={icon}
      description={description}
      headerAction={demo ? <StatusPill tone="neutral">Not available in demo</StatusPill> : undefined}
    >
      {demo ? (
        <FieldHint>Credential actions are disabled in the fictional demo workspace.</FieldHint>
      ) : loadError ? (
        <div role="alert"><FieldHint className="text-danger">Credential status is unavailable.</FieldHint></div>
      ) : (
        <div>
          {credentials.map((definition) => {
            const item = metadata.find((entry) => entry.key === definition.key);
            return item ? (
              <CredentialRow
                key={definition.key}
                definition={definition}
                metadata={item}
                onMetadata={onCredentialMetadataChange}
                onRefresh={onRefreshCredentialMetadata}
              />
            ) : null;
          })}
        </div>
      )}
    </SettingsCard>
  );
}
