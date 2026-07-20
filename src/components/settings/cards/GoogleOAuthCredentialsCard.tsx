import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { KeyRound } from "lucide-react";
import {
  disableGoogleOAuthApplication,
  getGmailAuthUrl,
  importGoogleOAuthEnvironment,
  stageGoogleOAuthApplication,
  useHostGoogleOAuthApplication as restoreHostGoogleOAuthApplication,
} from "@/api";
import { getCanonicalOriginStatus } from "@/auth/securityApi";
import { isDemoMode } from "@/demo/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FieldHint, SectionLabel, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import type { InstanceCredentialMetadata } from "../../../../shared/types/instance-credentials";
import { formatCredentialTimestamp } from "./coreCredentialModel";
import type { SettingsCredentialMetadataProps } from "../settingsTypes";
import {
  SensitiveActionStepUp,
} from "../SensitiveActionStepUp";
import {
  isPasswordStepUpRequired,
  useSensitiveActionStepUp,
} from "../sensitiveActionStepUpModel";

const CLIENT_ID_KEY = "google.oauth_client_id";
const CLIENT_SECRET_KEY = "google.oauth_client_secret";
const BUTTON_MOTION = "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

function sourceLabel(items: InstanceCredentialMetadata[]): string {
  const sources = new Set(items.map((item) => item.source));
  if (sources.size > 1) return "Mixed source";
  switch (items[0]?.source) {
    case "stored": return "Setpoint";
    case "environment": return "Host environment";
    case "disabled": return "Disabled";
    default: return "Not configured";
  }
}

export default function GoogleOAuthCredentialsCard({
  credentialMetadata,
  onCredentialMetadataChange,
  onRefreshCredentialMetadata,
}: SettingsCredentialMetadataProps) {
  const demo = isDemoMode();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const clientIdRef = useRef<HTMLInputElement | null>(null);
  const stepUp = useSensitiveActionStepUp();
  const credentialActionLocked = Boolean(stepUp.pendingLabel);

  function restoreFormFocus() {
    requestAnimationFrame(() => clientIdRef.current?.focus());
  }

  const metadataUnavailable = credentialMetadata === null;
  const credentials = (credentialMetadata ?? []).filter((item) => (
    item.key === CLIENT_ID_KEY || item.key === CLIENT_SECRET_KEY
  ));

  useEffect(() => {
    let active = true;
    if (demo) return;
    getCanonicalOriginStatus()
      .then((canonical) => {
        if (!active) return;
        setCallbackUrl(canonical.callbacks.find((item) => item.provider === "Google OAuth")?.nextUrl ?? null);
      })
      .catch(() => { if (active) setError("Google callback status is unavailable."); });
    return () => { active = false; };
  }, [demo]);

  async function saveCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId || !clientSecret || busy) return;
    const candidate = { clientId, clientSecret };
    await stepUp.run(async () => {
      let shouldRestoreFocus = true;
      setBusy("save"); setMessage(null); setError(null);
      try {
        const result = await stageGoogleOAuthApplication(candidate.clientId, candidate.clientSecret);
        setClientId(""); setClientSecret("");
        onCredentialMetadataChange(result.credentials);
        setMessage("Pending application saved. Connect Google to validate it; the active application remains in use until authorization succeeds.");
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) {
          shouldRestoreFocus = false;
          throw caught;
        }
        setError("The Google application candidate could not be saved.");
        await onRefreshCredentialMetadata().catch(() => {});
      } finally {
        setBusy(null);
        if (shouldRestoreFocus) restoreFormFocus();
      }
    }, "saving this Google application");
  }

  async function sourceAction(action: "import" | "disable" | "host") {
    await stepUp.run(async () => {
      let shouldRestoreFocus = true;
      setBusy(action); setMessage(null); setError(null);
      try {
        const result = action === "import"
          ? await importGoogleOAuthEnvironment()
          : action === "disable"
            ? await disableGoogleOAuthApplication()
            : await restoreHostGoogleOAuthApplication();
        onCredentialMetadataChange(result.credentials);
        setMessage(action === "import"
          ? "Copied into encrypted Setpoint storage. The Render variables still remain. Back up EA_ENCRYPTION_KEY, remove both Google variables in Render, redeploy, then verify Google before considering the migration complete."
          : action === "disable"
            ? "Stored and pending Google application credentials removed; host fallback is disabled."
            : "Host-managed Google application credentials are active again.");
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) {
          shouldRestoreFocus = false;
          throw caught;
        }
        setError("The Google application source could not be changed. No credential values were exposed.");
        await onRefreshCredentialMetadata().catch(() => {});
      } finally {
        setBusy(null);
        if (shouldRestoreFocus) restoreFormFocus();
      }
    }, action === "import"
      ? "copying the Google credentials into Setpoint"
      : action === "disable"
        ? "removing the Google credentials"
        : "restoring the host-managed Google credentials");
  }

  async function connectGoogle() {
    setBusy("connect"); setMessage(null); setError(null);
    try {
      const { url } = await getGmailAuthUrl();
      window.location.assign(url);
    } catch {
      setError("Google authorization could not be started. The active application is unchanged.");
      setBusy(null);
      await onRefreshCredentialMetadata().catch(() => {});
      restoreFormFocus();
    }
  }

  const configured = credentials.length === 2 && credentials.every((item) => item.activeConfigured);
  const pending = credentials.some((item) => item.pendingConfigured);
  const source = metadataUnavailable ? "Status unavailable" : sourceLabel(credentials);
  const sourceValue = credentials[0]?.source;
  const allEnvironment = credentials.length === 2 && credentials.every((item) => item.source === "environment");
  const allDisabled = credentials.length === 2 && credentials.every((item) => item.source === "disabled");
  const anyConfigured = credentials.some((item) => item.activeConfigured);
  const lastTestedAt = Math.max(0, ...credentials.map((item) => item.lastTestedAt ?? 0));
  const lastSucceededAt = Math.max(0, ...credentials.map((item) => item.lastSucceededAt ?? 0));
  const lastFailedAt = Math.max(0, ...credentials.map((item) => item.lastFailedAt ?? 0));
  const visibleError = error ?? (metadataUnavailable ? "Google application status is unavailable." : null);

  return (
    <SettingsCard
      title="Google application"
      icon={<KeyRound size={14} />}
      description="Deployment-specific OAuth credentials for the combined Gmail and Calendar connection."
      headerAction={demo ? <StatusPill tone="neutral">Not available in demo</StatusPill> : (
        <div className="flex flex-wrap gap-1.5">
          <StatusPill tone={configured ? "success" : sourceValue === "disabled" ? "warning" : "neutral"}>{source}</StatusPill>
          {pending ? <StatusPill tone="warning">Pending validation</StatusPill> : null}
        </div>
      )}
    >
      {demo ? <FieldHint>Google credential actions are disabled in the fictional demo workspace.</FieldHint> : (
        <div className="flex flex-col gap-3">
          <p className="max-w-[70ch] text-[11px] leading-relaxed text-muted-foreground">
            Saving creates a pending pair. Google authorization validates and promotes both values together, so a working application is never replaced by an unverified candidate.
          </p>
          <form onSubmit={saveCandidate} className="grid gap-3 sm:grid-cols-2">
            <div>
              <SectionLabel htmlFor="google-oauth-client-id">Client ID</SectionLabel>
              <Input ref={clientIdRef} id="google-oauth-client-id" value={clientId} autoComplete="off" placeholder="Google OAuth client ID" onChange={(event) => setClientId(event.target.value)} disabled={Boolean(busy) || credentialActionLocked} />
            </div>
            <div>
              <SectionLabel htmlFor="google-oauth-client-secret">Client secret</SectionLabel>
              <Input id="google-oauth-client-secret" type="password" value={clientSecret} autoComplete="new-password" placeholder="Google OAuth client secret" onChange={(event) => setClientSecret(event.target.value)} disabled={Boolean(busy) || credentialActionLocked} />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button type="submit" size="sm" variant="outline" className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)} disabled={!clientId || !clientSecret || Boolean(busy) || credentialActionLocked}>
                {busy === "save" ? "Saving…" : configured ? "Save replacement" : "Save application"}
              </Button>
              <Button type="button" size="sm" className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION)} disabled={Boolean(busy) || credentialActionLocked || (!configured && !pending)} onClick={connectGoogle}>
                {busy === "connect" ? "Opening Google…" : pending ? "Connect to validate" : "Connect Google"}
              </Button>
              {allEnvironment ? (
                <Button type="button" size="sm" variant="outline" className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)} disabled={Boolean(busy) || credentialActionLocked} onClick={() => sourceAction("import")}>
                  {busy === "import" ? "Copying…" : "Copy into Setpoint"}
                </Button>
              ) : null}
              {anyConfigured && !allDisabled ? (
                <Button type="button" size="sm" variant="destructive" className={BUTTON_MOTION} disabled={Boolean(busy) || credentialActionLocked} onClick={() => setConfirmingDisable(true)}>
                  Remove and disable
                </Button>
              ) : null}
              {allDisabled ? (
                <Button type="button" size="sm" variant="outline" className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)} disabled={Boolean(busy) || credentialActionLocked} onClick={() => sourceAction("host")}>
                  {busy === "host" ? "Checking host…" : "Use host value"}
                </Button>
              ) : null}
            </div>
          </form>
          {confirmingDisable ? (
            <div className="rounded-lg border border-danger/25 bg-danger/[0.05] p-3">
              <p className="max-w-[70ch] text-[11px] leading-relaxed text-foreground">
                This deletes both stored and pending Google application credentials and blocks host fallback. Google connections cannot be renewed until credentials are restored.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className={BUTTON_MOTION}
                  disabled={Boolean(busy) || credentialActionLocked}
                  onClick={() => { setConfirmingDisable(false); void sourceAction("disable"); }}
                >
                  {busy === "disable" ? "Removing…" : "Confirm remove Google credentials"}
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
          <SensitiveActionStepUp state={stepUp} />
          {callbackUrl ? (
            <div>
              <div className="text-[11px] font-medium text-foreground">Authorized redirect URI</div>
              <code className="mt-1 block break-all rounded-md bg-white/[0.04] px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{callbackUrl}</code>
            </div>
          ) : null}
          {lastTestedAt || lastSucceededAt || lastFailedAt ? (
            <FieldHint>
              {[
                lastTestedAt ? `Tested ${formatCredentialTimestamp(lastTestedAt)}` : null,
                lastSucceededAt ? `Last success ${formatCredentialTimestamp(lastSucceededAt)}` : null,
                lastFailedAt ? `Last failure ${formatCredentialTimestamp(lastFailedAt)}` : null,
              ].filter(Boolean).join(" · ")}
            </FieldHint>
          ) : null}
          {message ? <div role="status"><FieldHint className="text-[var(--sp-green)]">{message}</FieldHint></div> : null}
          {visibleError ? <div role="alert"><FieldHint className="text-danger">{visibleError}</FieldHint></div> : null}
        </div>
      )}
    </SettingsCard>
  );
}
