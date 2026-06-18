import { useEffect, useState } from "react";
import { AlertTriangle, Fingerprint, KeyRound, Trash2 } from "lucide-react";
import {
  deletePasskeyCredential,
  getPasskeyRegistrationOptions,
  listPasskeys,
  verifyPasskeyRegistration,
} from "@/api";
import { startPasskeyRegistration } from "@/auth/passkeyBrowser.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FieldHint,
  SectionLabel,
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_GHOST_BUTTON_CLASS,
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
  SURFACE_ROW_CLASS,
} from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";

function formatDate(ms) {
  if (!ms) return "never";
  return new Date(Number(ms)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTransports(transports) {
  return Array.isArray(transports) && transports.length ? transports.join(", ") : "Transport unknown";
}

function formatBackupState(backedUp) {
  if (backedUp === true) return "Backed up";
  if (backedUp === false) return "Not backed up";
  return "Backup unknown";
}

function mergeRegisteredPasskey(passkeys, passkey) {
  return [
    passkey,
    ...passkeys.filter((item) => item.credentialId !== passkey.credentialId),
  ];
}

export default function PasskeysCard() {
  const [passkeys, setPasskeys] = useState(null);
  const [enforcementActive, setEnforcementActive] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [label, setLabel] = useState("");
  const [registering, setRegistering] = useState(false);
  const [busyCredentialId, setBusyCredentialId] = useState(null);
  const [confirmingCredentialId, setConfirmingCredentialId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listPasskeys()
      .then((result) => {
        if (cancelled) return;
        setPasskeys(result.passkeys || []);
        setEnforcementActive(Boolean(result.enforcementActive));
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message || "Failed to load passkeys");
      });
    return () => { cancelled = true; };
  }, []);

  async function handleRegister(event) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel || registering) return;
    setRegistering(true);
    setActionError(null);
    try {
      const options = await getPasskeyRegistrationOptions(trimmedLabel);
      const credential = await startPasskeyRegistration(options);
      const result = await verifyPasskeyRegistration({ ...credential, label: trimmedLabel });
      setPasskeys((current) => mergeRegisteredPasskey(current || [], result.passkey));
      setEnforcementActive(Boolean(result.enforcementActive));
      setLabel("");
    } catch (error) {
      setActionError(error.message || "Passkey registration failed");
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(credentialId) {
    setBusyCredentialId(credentialId);
    setActionError(null);
    try {
      const result = await deletePasskeyCredential(credentialId);
      setPasskeys(result.passkeys || []);
      setEnforcementActive(Boolean(result.enforcementActive));
      setConfirmingCredentialId(null);
    } catch (error) {
      setActionError(error.message || "Failed to delete passkey");
    } finally {
      setBusyCredentialId(null);
    }
  }

  const loadedPasskeys = passkeys || [];
  const hasPasskeys = loadedPasskeys.length > 0;

  return (
    <SettingsCard
      title="Passkeys"
      icon={<Fingerprint size={14} />}
      description="Require a registered passkey after the dashboard password. Keep at least two passkeys when possible."
      headerAction={(
        <StatusPill tone={enforcementActive ? "success" : "warning"}>
          {enforcementActive ? "Enforced" : "Setup mode"}
        </StatusPill>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-3">
          <div className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground/75">
            <KeyRound size={14} className="mt-0.5 shrink-0 text-primary/75" />
            <div>
              {enforcementActive ? (
                <>
                  Future logins require your password and a registered passkey.
                  {" "}
                  Add a second passkey when practical so one lost device does not lock you out.
                </>
              ) : (
                <>
                  Future logins stay password-only until a passkey is registered.
                  {" "}
                  Use a device passkey or hardware security key that is stored separately from your dashboard password.
                </>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleRegister} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <SectionLabel>New passkey label</SectionLabel>
            <Input
              type="text"
              placeholder="MacBook Touch ID"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                if (actionError) setActionError(null);
              }}
              disabled={registering}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            disabled={!label.trim() || registering}
          >
            {registering ? "Adding..." : "Add passkey"}
          </Button>
        </form>

        {actionError ? (
          <FieldHint className="text-danger">{actionError}</FieldHint>
        ) : null}

        {loadError ? (
          <FieldHint className="text-danger">Failed to load passkeys: {loadError}</FieldHint>
        ) : passkeys === null ? (
          <FieldHint>Loading...</FieldHint>
        ) : !hasPasskeys ? (
          <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground/75">
            No passkeys registered.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {loadedPasskeys.map((passkey) => {
              const confirming = confirmingCredentialId === passkey.credentialId;
              const busy = busyCredentialId === passkey.credentialId;
              return (
                <div
                  key={passkey.credentialId}
                  className={cn(SURFACE_ROW_CLASS, "flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground/90">
                        {passkey.label}
                      </span>
                      <StatusPill tone={passkey.backedUp === false ? "warning" : "neutral"}>
                        {formatBackupState(passkey.backedUp)}
                      </StatusPill>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground/75">
                      <span>Created {formatDate(passkey.createdAt)}</span>
                      <span>Last used {formatDate(passkey.lastUsedAt)}</span>
                      <span>{formatTransports(passkey.transports)}</span>
                    </div>
                  </div>

                  {confirming ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="border border-destructive/20 bg-destructive/10"
                        disabled={busy}
                        onClick={() => handleDelete(passkey.credentialId)}
                      >
                        {busy ? "Deleting..." : "Confirm delete"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={SETTINGS_GHOST_BUTTON_CLASS}
                        disabled={busy}
                        onClick={() => setConfirmingCredentialId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className={SETTINGS_SECONDARY_BUTTON_CLASS}
                      aria-label={`Delete ${passkey.label}`}
                      onClick={() => setConfirmingCredentialId(passkey.credentialId)}
                    >
                      <Trash2 size={12} />
                      Delete
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <FieldHint className="flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Deleting the final passkey returns the dashboard to setup mode for future password logins.
        </FieldHint>
      </div>
    </SettingsCard>
  );
}
