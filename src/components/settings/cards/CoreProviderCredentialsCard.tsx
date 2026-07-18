import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  disableInstanceCredential,
  getInstanceCredentials,
  importInstanceCredentialEnvironment,
  stageInstanceCredential,
  testInstanceCredential,
  useHostInstanceCredential,
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
} from "./coreCredentialModel";
import type { InstanceCredentialMetadata } from "../../../../shared/types/instance-credentials";

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
  const status = credentialStatusView(metadata);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function restoreInputFocus() {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function testPending() {
    setBusy("test");
    setMessage(null);
    setError(null);
    try {
      const result = await testInstanceCredential(definition.key);
      onMetadata(result.metadata);
      setMessage("Validated and activated. Runtime configuration is updated.");
    } catch (caught) {
      setError(credentialErrorMessage(apiErrorCode(caught)));
      await onRefresh().catch(() => {});
    } finally {
      setBusy(null);
      restoreInputFocus();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy("save");
    setMessage(null);
    setError(null);
    try {
      const staged = await stageInstanceCredential(definition.key, draft);
      setDraft("");
      onMetadata(staged);
      setBusy("test");
      await testPending();
    } catch (caught) {
      setDraft("");
      setError(credentialErrorMessage(apiErrorCode(caught)));
      await onRefresh().catch(() => {});
      setBusy(null);
      restoreInputFocus();
    }
  }

  async function runSourceAction(action: "import" | "disable" | "host") {
    setBusy(action);
    setMessage(null);
    setError(null);
    try {
      const updated = action === "import"
        ? await importInstanceCredentialEnvironment(definition.key)
        : action === "disable"
          ? await disableInstanceCredential(definition.key)
          : await useHostInstanceCredential(definition.key);
      onMetadata(updated);
      setMessage(action === "import"
        ? "Moved into encrypted Setpoint storage."
        : action === "disable"
          ? "Stored and pending values removed; host fallback is disabled."
          : "Host-managed configuration is active again.");
    } catch (caught) {
      setError(credentialErrorMessage(apiErrorCode(caught)));
    } finally {
      setBusy(null);
      restoreInputFocus();
    }
  }

  const lastTest = formatCredentialTimestamp(metadata.lastTestedAt);
  const lastSuccess = formatCredentialTimestamp(metadata.lastSucceededAt);
  const lastFailure = formatCredentialTimestamp(metadata.lastFailedAt);
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
            disabled={Boolean(busy)}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION)}
          disabled={!draft || Boolean(busy)}
        >
          {busy === "save" || busy === "test" ? "Testing…" : metadata.activeConfigured ? "Test replacement" : "Test and save"}
        </Button>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {metadata.pendingConfigured ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
            disabled={Boolean(busy)}
            onClick={testPending}
          >
            {busy === "test" ? "Testing…" : "Retest pending"}
          </Button>
        ) : null}
        {metadata.source === "environment" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
            disabled={Boolean(busy)}
            onClick={() => runSourceAction("import")}
          >
            {busy === "import" ? "Moving…" : "Move into Setpoint"}
          </Button>
        ) : null}
        {metadata.source !== "disabled" && metadata.source !== "absent" ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className={BUTTON_MOTION}
            disabled={Boolean(busy)}
            onClick={() => runSourceAction("disable")}
          >
            {busy === "disable" ? "Disabling…" : "Remove and disable"}
          </Button>
        ) : null}
        {metadata.source === "disabled" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
            disabled={Boolean(busy)}
            onClick={() => runSourceAction("host")}
          >
            {busy === "host" ? "Checking host…" : "Use host value"}
          </Button>
        ) : null}
      </div>
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
  title,
  icon,
  description,
  credentials,
}: {
  title: string;
  icon: ReactNode;
  description: string;
  credentials: CoreCredentialDefinition[];
}) {
  const demo = isDemoMode();
  const [metadata, setMetadata] = useState<InstanceCredentialMetadata[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    if (demo) return;
    const result = await getInstanceCredentials();
    setMetadata(result.credentials);
    setLoadError(false);
  }, [demo]);

  useEffect(() => {
    let active = true;
    if (demo) return;
    getInstanceCredentials()
      .then((result) => { if (active) setMetadata(result.credentials); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demo]);

  function updateMetadata(updated: InstanceCredentialMetadata) {
    setMetadata((current) => current.map((item) => item.key === updated.key ? updated : item));
  }

  return (
    <SettingsCard
      title={title}
      icon={icon}
      description={description}
      headerAction={demo ? <StatusPill tone="neutral">Not available in demo</StatusPill> : undefined}
    >
      {demo ? (
        <FieldHint>Credential actions are disabled in the fictional demo workspace.</FieldHint>
      ) : loading ? (
        <FieldHint>Loading credential status…</FieldHint>
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
                onMetadata={updateMetadata}
                onRefresh={refresh}
              />
            ) : null;
          })}
        </div>
      )}
    </SettingsCard>
  );
}
