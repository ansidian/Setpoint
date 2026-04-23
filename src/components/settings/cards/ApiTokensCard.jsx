import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { listApiTokens, createApiToken, revokeApiToken } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function useConfirm() {
  const [pending, setPending] = useState(null);
  const confirm = useCallback(
    (message) => new Promise((resolve) => setPending({ message, resolve })),
    []
  );
  const close = (value) => {
    pending?.resolve(value);
    setPending(null);
  };
  const dialog = (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open) close(false); }}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Confirm</DialogTitle>
        <DialogDescription>{pending?.message}</DialogDescription>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => close(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={() => close(true)}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { confirm, dialog };
}

function formatDate(ms) {
  if (!ms) return "never";
  const date = new Date(Number(ms));
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ApiTokensCard() {
  const [tokens, setTokens] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    listApiTokens()
      .then(setTokens)
      .catch((error) => setLoadError(error.message));
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    if (!label.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createApiToken(label.trim(), ["actual:write"]);
      setNewToken({ token: result.token, label: result.label, expiresAt: result.expires_at });
      setLabel("");
      const nextTokens = await listApiTokens();
      setTokens(nextTokens);
    } catch (error) {
      setCreateError(error.message || "Failed to create token");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id) {
    if (!await confirm("Revoke this token? Any device using it will stop working immediately.")) return;
    setBusyId(id);
    try {
      await revokeApiToken(id);
      setTokens((current) => current.filter((token) => token.id !== id));
    } catch (error) {
      console.error("Revoke failed:", error);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(newToken.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable. The token stays selectable in the input.
    }
  }

  return (
    <>
      <SettingsCard
        title="API Tokens"
        icon={<KeyRound size={14} />}
        description="Bearer tokens for mobile shortcuts and other personal automation. Tokens are shown once at creation."
      >
        <div className="flex flex-col gap-4">
          {newToken ? (
            <div className="rounded-xl border border-[#f9e2af]/20 bg-[#f9e2af]/10 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <StatusPill tone="warning">Copy now</StatusPill>
                <span className="text-[11px] text-muted-foreground/70">Label: {newToken.label}</span>
              </div>
              <div className="mb-2 text-[11px] text-muted-foreground/70">
                Expires {formatDate(newToken.expiresAt)}
              </div>
              <div className="mb-3 rounded-lg border border-black/10 bg-black/30 px-3 py-2 font-mono text-xs break-all select-all">
                {newToken.token}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleCopy}
                  variant="secondary"
                  className={SETTINGS_SECONDARY_BUTTON_CLASS}
                >
                  <Copy size={12} />
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={SETTINGS_GHOST_BUTTON_CLASS}
                  onClick={() => setNewToken(null)}
                >
                  I&apos;ve saved it
                </Button>
              </div>
            </div>
          ) : null}

          <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <SectionLabel>New token label</SectionLabel>
              <Input
                type="text"
                placeholder="iPhone Shortcuts"
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value);
                  if (createError) setCreateError(null);
                }}
                disabled={creating}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className={SETTINGS_PRIMARY_BUTTON_CLASS}
              disabled={!label.trim() || creating}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </form>

          {createError ? (
            <FieldHint className="text-danger">{createError}</FieldHint>
          ) : null}

          {loadError ? (
            <FieldHint className="text-danger">Failed to load tokens: {loadError}</FieldHint>
          ) : tokens === null ? (
            <FieldHint>Loading…</FieldHint>
          ) : tokens.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground/60">
              No tokens yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className={cn(SURFACE_ROW_CLASS, "flex items-center gap-3 px-3 py-3")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground/90">{token.label}</span>
                      <StatusPill tone="neutral" className="shrink-0">
                        {token.scopes.join(", ") || "no scopes"}
                      </StatusPill>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground/65">
                      <span>Created {formatDate(token.created_at)}</span>
                      <span>Last used {formatDate(token.last_used_at)}</span>
                      <span>Expires {formatDate(token.expires_at)}</span>
                    </div>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="destructive"
                    className="border border-destructive/20 bg-destructive/10"
                    onClick={() => handleRevoke(token.id)}
                    disabled={busyId === token.id}
                    title="Revoke token"
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsCard>
      {confirmDialog}
    </>
  );
}
