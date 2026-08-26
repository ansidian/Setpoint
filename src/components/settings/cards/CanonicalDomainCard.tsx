import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Globe2, TriangleAlert } from "lucide-react";
import {
  changeCanonicalOrigin,
  getCanonicalOriginStatus,
  previewCanonicalOriginChange,
  stepUpWithPassword,
} from "@/auth/securityApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldHint, SectionLabel, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";
import type { CanonicalOriginImpact } from "../../../../shared/types/canonical-url";

const BUTTON_MOTION = "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";
const messageFor = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export default function CanonicalDomainCard() {
  const [origin, setOrigin] = useState("");
  const [recentAuth, setRecentAuth] = useState(false);
  const [impact, setImpact] = useState<CanonicalOriginImpact | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"load" | "unlock" | "preview" | "change" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCanonicalOriginStatus()
      .then((status) => {
        if (cancelled) return;
        setOrigin(status.currentOrigin || "");
        setRecentAuth(status.recentAuth);
      })
      .catch((error) => { if (!cancelled) setError(messageFor(error, "Could not load canonical URL")); })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, []);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy("unlock"); setError(null);
    try {
      await stepUpWithPassword(password);
      setRecentAuth(true); setPassword("");
    } catch (error) {
      setError(messageFor(error, "Password confirmation failed"));
    } finally { setBusy(null); }
  }

  async function preview() {
    if (!origin || busy) return;
    setBusy("preview"); setError(null); setSaved(false); setAcknowledged(false);
    try { setImpact(await previewCanonicalOriginChange(origin)); }
    catch (error) { setError(messageFor(error, "Could not preview domain change")); }
    finally { setBusy(null); }
  }

  async function applyChange() {
    if (!impact || impact.currentOrigin === impact.proposedOrigin || !acknowledged || busy) return;
    setBusy("change"); setError(null);
    try {
      const changed = await changeCanonicalOrigin(impact.proposedOrigin);
      setOrigin(changed.proposedOrigin); setImpact(null); setAcknowledged(false); setSaved(true);
    } catch (error) { setError(messageFor(error, "Could not change canonical URL")); }
    finally { setBusy(null); }
  }

  return (
    <SettingsCard
      title="Canonical domain"
      icon={<Globe2 size={14} />}
      description="One confirmed origin controls passkeys and every Setpoint-owned provider callback."
      headerAction={<StatusPill tone={error ? "danger" : "success"}>{error ? "Needs attention" : "Configured"}</StatusPill>}
    >
      <div className="flex flex-col gap-3">
        {busy === "load" ? <FieldHint>Loading canonical URL…</FieldHint> : !recentAuth ? (
          <form onSubmit={unlock} className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <SectionLabel htmlFor="canonical-domain-password">Current password for domain changes</SectionLabel>
                <Input id="canonical-domain-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy === "unlock"} />
              </div>
              <Button type="submit" size="sm" className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION)} disabled={!password || busy === "unlock"}>
                {busy === "unlock" ? "Unlocking…" : "Unlock domain changes"}
              </Button>
            </div>
            <FieldHint className="mt-2">Domain changes require recent password confirmation.</FieldHint>
          </form>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <SectionLabel htmlFor="canonical-origin">Canonical Setpoint URL</SectionLabel>
                <Input id="canonical-origin" type="url" autoComplete="url" value={origin} onChange={(event) => { setOrigin(event.target.value); setImpact(null); setSaved(false); }} />
              </div>
              <Button size="sm" variant="secondary" className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)} disabled={!origin || Boolean(busy)} onClick={preview}>
                {busy === "preview" ? "Checking…" : "Preview change"}
              </Button>
            </div>
            {impact && impact.currentOrigin === impact.proposedOrigin ? (
              <div role="status" className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3 text-[12px] leading-relaxed text-muted-foreground">
                This is already the canonical URL. No changes are needed.
              </div>
            ) : impact ? (
              <div className="rounded-lg border border-[var(--sp-cream)]/20 bg-[var(--sp-cream)]/5 p-3">
                <div className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[var(--sp-cream)]" />
                  <span>{impact.affectedPasskeys} registered passkeys may stop working on the new domain. External provider consoles must be updated manually.</span>
                </div>
                <ul className="mt-3 flex flex-col gap-2">
                  {impact.callbacks.map((callback) => (
                    <li key={callback.provider} className="min-w-0 rounded-md border border-white/[0.06] bg-black/10 px-2.5 py-2">
                      <div className="text-[11px] font-medium text-foreground">{callback.provider}</div>
                      <code className="mt-1 block break-all text-[10px] text-muted-foreground">{callback.nextUrl}</code>
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-foreground">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--sp-accent)]" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                  <span>I understand passkeys and provider registrations may need to be recreated or updated.</span>
                </label>
                <Button size="sm" className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION, "mt-3")} disabled={!acknowledged || busy === "change"} onClick={applyChange}>
                  {busy === "change" ? "Changing…" : "Change canonical URL"}
                </Button>
              </div>
            ) : null}
          </>
        )}
        {saved ? <FieldHint className="text-[var(--sp-green)]">Canonical URL updated.</FieldHint> : null}
        {error ? <div role="alert"><FieldHint className="text-danger">{error}</FieldHint></div> : null}
      </div>
    </SettingsCard>
  );
}
