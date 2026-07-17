import { useEffect, useState } from "react";
import { AlertTriangle, Fingerprint, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import {
  deletePasskeyCredential,
  getPasskeyRegistrationOptions,
  listPasskeys,
  verifyPasskeyRegistration,
} from "@/api";
import {
  changeOwnerPassword,
  regenerateRecoveryCodes,
  stepUpWithPassword,
  updateOwnerAuthMode,
} from "@/auth/securityApi";
import { startPasskeyRegistration } from "@/auth/passkeyBrowser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldHint, SectionLabel, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import {
  SETTINGS_GHOST_BUTTON_CLASS,
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
  SURFACE_ROW_CLASS,
} from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";
import type { FormEvent } from "react";
import type { OwnerAuthMode, PasskeyMetadata, RecoveryCodeStatus } from "../../../../shared/types/accounts";

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function formatDate(ms: number | null | undefined) {
  if (!ms) return "never";
  return new Date(Number(ms)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTransports(transports: string[]) {
  return Array.isArray(transports) && transports.length ? transports.join(", ") : "Transport unknown";
}

function formatBackupState(backedUp: boolean | null) {
  if (backedUp === true) return "Backed up";
  if (backedUp === false) return "Not backed up";
  return "Backup unknown";
}

function mergeRegisteredPasskey(passkeys: PasskeyMetadata[], passkey: PasskeyMetadata) {
  return [passkey, ...passkeys.filter((item) => item.credentialId !== passkey.credentialId)];
}

const emptyRecovery: RecoveryCodeStatus = { remaining: 0, generatedAt: null };
const BUTTON_MOTION_CLASS = "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

export default function PasskeysCard() {
  const [passkeys, setPasskeys] = useState<PasskeyMetadata[] | null>(null);
  const [authMode, setAuthMode] = useState<OwnerAuthMode>("password_or_passkey");
  const [recentAuth, setRecentAuth] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryCodeStatus>(emptyRecovery);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmingCredentialId, setConfirmingCredentialId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPasskeys()
      .then((result) => {
        if (cancelled) return;
        setPasskeys(result.passkeys || []);
        setAuthMode(result.authMode || "password_or_passkey");
        setRecentAuth(Boolean(result.recentAuth));
        setRecovery(result.recovery || emptyRecovery);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error, "Failed to load sign-in settings"));
      });
    return () => { cancelled = true; };
  }, []);

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPassword || busyAction) return;
    setBusyAction("unlock");
    setActionError(null);
    try {
      await stepUpWithPassword(currentPassword);
      setRecentAuth(true);
      setCurrentPassword("");
    } catch (error) {
      setActionError(errorMessage(error, "Password confirmation failed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel || busyAction || !recentAuth) return;
    setBusyAction("register");
    setActionError(null);
    try {
      const options = await getPasskeyRegistrationOptions(trimmedLabel);
      const credential = await startPasskeyRegistration(options);
      const result = await verifyPasskeyRegistration({ ...credential, label: trimmedLabel });
      setPasskeys((current) => mergeRegisteredPasskey(current || [], result.passkey));
      setAuthMode(result.authMode || "password_or_passkey");
      setLabel("");
    } catch (error) {
      setActionError(errorMessage(error, "Passkey registration failed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete(credentialId: string) {
    setBusyAction(`delete:${credentialId}`);
    setActionError(null);
    try {
      const result = await deletePasskeyCredential(credentialId);
      setPasskeys(result.passkeys || []);
      setAuthMode(result.authMode || "password_or_passkey");
      setRecentAuth(Boolean(result.recentAuth));
      setRecovery(result.recovery || recovery);
      setConfirmingCredentialId(null);
    } catch (error) {
      setActionError(errorMessage(error, "Failed to delete passkey"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleModeChange() {
    const nextMode: OwnerAuthMode = authMode === "password_plus_passkey"
      ? "password_or_passkey"
      : "password_plus_passkey";
    setBusyAction("mode");
    setActionError(null);
    try {
      const result = await updateOwnerAuthMode(nextMode);
      setAuthMode(result.authMode);
      setRecentAuth(true);
    } catch (error) {
      setActionError(errorMessage(error, "Could not change sign-in mode"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newPassword || busyAction) return;
    if (newPassword !== passwordConfirmation) {
      setActionError("New passwords do not match");
      return;
    }
    setBusyAction("password");
    setActionError(null);
    try {
      await changeOwnerPassword(newPassword);
      setNewPassword("");
      setPasswordConfirmation("");
      setRecentAuth(true);
    } catch (error) {
      setActionError(errorMessage(error, "Could not change password"));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRegenerateCodes() {
    setBusyAction("recovery");
    setActionError(null);
    try {
      const result = await regenerateRecoveryCodes();
      setRevealedCodes(result.recoveryCodes);
      setRecovery({ remaining: result.recoveryCodes.length, generatedAt: Date.now() });
    } catch (error) {
      setActionError(errorMessage(error, "Could not generate recovery codes"));
    } finally {
      setBusyAction(null);
    }
  }

  const loadedPasskeys = passkeys || [];
  const hasPasskeys = loadedPasskeys.length > 0;
  const strictMode = authMode === "password_plus_passkey";

  return (
    <SettingsCard
      title="Sign-in & recovery"
      icon={<Fingerprint size={14} />}
      description="Choose password-or-passkey access, or explicitly require both. Security changes need recent password confirmation."
      headerAction={(
        <StatusPill tone={strictMode ? "success" : "neutral"}>
          {strictMode ? "Password + passkey" : "Password or passkey"}
        </StatusPill>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-3">
          <div className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground/75">
            <KeyRound size={14} className="mt-0.5 shrink-0 text-primary/75" />
            <div>
              {strictMode ? (
                <>Future logins require your password and a registered passkey. Add a second passkey when practical.</>
              ) : (
                <>Password stays available after you register a passkey. Use a device passkey or hardware security key for passwordless sign-in.</>
              )}
            </div>
          </div>
        </div>

        {loadError ? (
          <FieldHint className="text-danger">{loadError}</FieldHint>
        ) : passkeys === null ? (
          <FieldHint>Loading sign-in settings…</FieldHint>
        ) : !recentAuth ? (
          <form onSubmit={handleUnlock} className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <SectionLabel htmlFor="security-current-password">Current password</SectionLabel>
                <Input
                  id="security-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  disabled={busyAction === "unlock"}
                />
              </div>
              <Button type="submit" size="sm" className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)} disabled={!currentPassword || busyAction === "unlock"}>
                {busyAction === "unlock" ? "Unlocking…" : "Unlock security changes"}
              </Button>
            </div>
            <FieldHint className="mt-2">Confirmation stays valid for ten minutes.</FieldHint>
          </form>
        ) : (
          <>
            {hasPasskeys ? (
              <div className={cn(SURFACE_ROW_CLASS, "flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center")}>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-foreground">Sign-in mode</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground/75">
                    {strictMode ? "Both factors are required at every login." : "Either your password or any registered passkey can sign you in."}
                  </div>
                </div>
                <Button size="sm" variant="secondary" className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)} disabled={busyAction === "mode"} onClick={handleModeChange}>
                  <ShieldCheck size={12} />
                  {strictMode ? "Allow password or passkey" : "Require password + passkey"}
                </Button>
              </div>
            ) : null}

            <form onSubmit={handleRegister} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <SectionLabel htmlFor="new-passkey-label">New passkey label</SectionLabel>
                <Input
                  id="new-passkey-label"
                  type="text"
                  placeholder="MacBook Touch ID"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  disabled={busyAction === "register"}
                />
              </div>
              <Button type="submit" size="sm" className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)} disabled={!label.trim() || busyAction === "register"}>
                {busyAction === "register" ? "Adding…" : "Add passkey"}
              </Button>
            </form>

            {!hasPasskeys ? (
              <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground/75">
                No passkeys registered.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {loadedPasskeys.map((passkey) => {
                  const confirming = confirmingCredentialId === passkey.credentialId;
                  const busy = busyAction === `delete:${passkey.credentialId}`;
                  return (
                    <div key={passkey.credentialId} className={cn(SURFACE_ROW_CLASS, "flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground/90">{passkey.label}</span>
                          <StatusPill tone={passkey.backedUp === false ? "warning" : "neutral"}>{formatBackupState(passkey.backedUp)}</StatusPill>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground/75">
                          <span>Created {formatDate(passkey.createdAt)}</span>
                          <span>Last used {formatDate(passkey.lastUsedAt)}</span>
                          <span>{formatTransports(passkey.transports)}</span>
                        </div>
                      </div>
                      {confirming ? (
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Button size="sm" variant="destructive" className="border border-destructive/20 bg-destructive/10" disabled={busy} onClick={() => handleDelete(passkey.credentialId)}>
                            {busy ? "Deleting…" : "Confirm delete"}
                          </Button>
                          <Button size="sm" variant="ghost" className={SETTINGS_GHOST_BUTTON_CLASS} disabled={busy} onClick={() => setConfirmingCredentialId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)} aria-label={`Delete ${passkey.label}`} onClick={() => setConfirmingCredentialId(passkey.credentialId)}>
                          <Trash2 size={12} /> Delete
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="rounded-lg border border-white/[0.08] p-3">
              <div className="mb-3 text-[12px] font-medium text-foreground">Change owner password</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <SectionLabel htmlFor="new-owner-password">New password</SectionLabel>
                  <Input id="new-owner-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busyAction === "password"} />
                </div>
                <div>
                  <SectionLabel htmlFor="confirm-owner-password">Confirm new password</SectionLabel>
                  <Input id="confirm-owner-password" type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} disabled={busyAction === "password"} />
                </div>
              </div>
              <Button type="submit" size="sm" className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION_CLASS, "mt-3")} disabled={!newPassword || !passwordConfirmation || busyAction === "password"}>
                {busyAction === "password" ? "Changing…" : "Change password"}
              </Button>
            </form>

            <div className="rounded-lg border border-white/[0.08] p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-foreground">Offline recovery codes</div>
                  <div className="mt-1 text-[11px] text-muted-foreground/75">
                    {recovery.remaining > 0 ? `${recovery.remaining} unused codes remain.` : "No recovery codes are available yet."}
                  </div>
                </div>
                <Button size="sm" variant="secondary" className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)} disabled={busyAction === "recovery"} onClick={handleRegenerateCodes}>
                  {busyAction === "recovery" ? "Generating…" : recovery.remaining > 0 ? "Regenerate recovery codes" : "Generate recovery codes"}
                </Button>
              </div>
              {revealedCodes ? (
                <div className="mt-3 rounded-lg border border-[var(--sp-cream)]/20 bg-[var(--sp-cream)]/5 p-3">
                  <ul aria-label="New recovery codes" className="grid gap-2 sm:grid-cols-2">
                    {revealedCodes.map((code) => <li key={code}><code className="block select-all break-all rounded-md bg-black/20 px-2 py-1.5 text-[11px] text-foreground">{code}</code></li>)}
                  </ul>
                  <Button size="sm" className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION_CLASS, "mt-3")} onClick={() => setRevealedCodes(null)}>I saved these codes</Button>
                </div>
              ) : null}
            </div>
          </>
        )}

        {actionError ? <div role="alert"><FieldHint className="text-danger">{actionError}</FieldHint></div> : null}
        <FieldHint className="flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Recovery resets passkeys, signs out other sessions, and returns sign-in mode to password or passkey.
        </FieldHint>
      </div>
    </SettingsCard>
  );
}
