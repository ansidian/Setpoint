import { useEffect, useRef, useState } from "react";
import { RadioTower, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDemoMode } from "@/demo/config";
import {
  generateGmailPubSubCallback,
  getGmailPubSubStatus,
  importGmailPubSubEnvironmentToken,
  revokeGmailPubSubToken,
  setGmailPubSubTopic,
  testGmailPubSubWatches,
} from "@/lib/gmailPubSubSetupApi";
import type { GmailPubSubStatus } from "../../../../shared/types/email";
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from "../settings-core";
import { FieldHint, SectionLabel, SettingsCard, StatusPill } from "../settings-ui";

const BUTTON_MOTION = "min-h-11 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0 sm:min-h-8";

export default function GmailRealtimeCard({ openAdvancedSetup = false }: { openAdvancedSetup?: boolean }) {
  const demo = isDemoMode();
  const [status, setStatus] = useState<GmailPubSubStatus | null>(null);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revealedCallback, setRevealedCallback] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(openAdvancedSetup);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (demo) return;
    let active = true;
    getGmailPubSubStatus()
      .then((result) => { if (active) setStatus(result); })
      .catch(() => { if (active) setMessage("Gmail real-time status is unavailable."); });
    return () => { active = false; };
  }, [demo]);

  useEffect(() => {
    if (revealedCallback) closeRef.current?.focus();
  }, [revealedCallback]);

  useEffect(() => {
    if (openAdvancedSetup) setAdvancedOpen(true);
  }, [openAdvancedSetup]);

  async function run(action: () => Promise<GmailPubSubStatus>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      setStatus(await action());
      setMessage(success);
    } catch {
      setMessage("The Gmail real-time configuration could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (status?.pushToken.configured && !window.confirm(
      "Regenerating invalidates the existing Pub/Sub subscription callback token. Update the external subscription immediately or real-time delivery will stop.",
    )) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await generateGmailPubSubCallback();
      setStatus(result.status);
      setCopyMessage(null);
      setRevealedCallback(result.callbackUrl);
    } catch {
      setMessage("A callback could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  const periodic = !status?.configured;
  return (
    <SettingsCard
      id="gmail-realtime-delivery"
      ready={demo || status !== null || message !== null}
      title="Gmail real-time delivery"
      icon={<RadioTower size={14} />}
      description="Optional enhancement. Periodic reconciliation keeps Gmail working when Pub/Sub is skipped."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="success">{periodic ? "Periodic updates active" : "Near real-time + periodic"}</StatusPill>
          {demo ? <FieldHint>Demo preview — controls are inert.</FieldHint> : null}
        </div>
        {!demo ? (
          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            className="border-t border-white/[0.06] pt-4"
          >
            <summary id="gmail-realtime-advanced-setup" className="-mx-1 min-h-11 cursor-pointer rounded-md px-1 py-3 text-[11px] font-semibold text-muted-foreground transition-[color,background-color] duration-200 hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:bg-white/[0.06] motion-reduce:transition-none sm:min-h-8 sm:py-2">
              Advanced Pub/Sub setup
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              <div>
                <SectionLabel htmlFor="gmail-pubsub-topic">Google Cloud topic</SectionLabel>
                <Input id="gmail-pubsub-topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="projects/project-id/topics/gmail" />
                <FieldHint className="mt-1">Saving a topic does not expose or replace the callback token.</FieldHint>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || !topic.trim()} className={`${SETTINGS_SECONDARY_BUTTON_CLASS} ${BUTTON_MOTION}`} onClick={() => run(async () => {
                  await setGmailPubSubTopic(topic.trim());
                  setTopic("");
                  return getGmailPubSubStatus();
                }, "Pub/Sub topic saved.")}>Save topic</Button>
                <Button size="sm" disabled={busy} className={`${SETTINGS_PRIMARY_BUTTON_CLASS} ${BUTTON_MOTION}`} onClick={handleGenerate}>
                  {status?.pushToken.configured ? "Regenerate callback" : "Generate callback"}
                </Button>
                <Button size="sm" disabled={busy || !status?.configured} className={`${SETTINGS_SECONDARY_BUTTON_CLASS} ${BUTTON_MOTION}`} onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await testGmailPubSubWatches();
                    setMessage(result.ok ? `Watch registration succeeded for ${result.registered} account(s).` : "Watch registration needs attention.");
                    setStatus(await getGmailPubSubStatus());
                  } catch { setMessage("Watch registration needs attention."); } finally { setBusy(false); }
                }}>Test watches</Button>
                {status?.pushToken.source === "environment" ? (
                  <Button size="sm" disabled={busy} className={`${SETTINGS_SECONDARY_BUTTON_CLASS} ${BUTTON_MOTION}`} onClick={() => run(importGmailPubSubEnvironmentToken, "Host token migrated into Setpoint.")}>Migrate host token</Button>
                ) : null}
                {status?.pushToken.configured ? (
                  <Button variant="destructive" size="sm" disabled={busy} className={BUTTON_MOTION} onClick={() => {
                    if (!window.confirm("Revoke this callback token? The external Pub/Sub subscription will stop delivering until it is updated.")) return;
                    void run(revokeGmailPubSubToken, "Callback revoked. Periodic updates remain active.");
                  }}>Revoke callback</Button>
                ) : null}
              </div>
              {status?.callbackUrl ? <FieldHint>Callback base: {status.callbackUrl}</FieldHint> : null}
              {message ? <FieldHint>{message}</FieldHint> : null}
            </div>
          </details>
        ) : null}
      </div>

      {revealedCallback ? (
        <div role="dialog" aria-label="Gmail callback created" className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.07] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold text-foreground">Copy this callback now</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">It includes a one-time-visible token and cannot be retrieved after this panel closes.</p>
            </div>
            <button ref={closeRef} type="button" aria-label="Close callback" onClick={() => { setRevealedCallback(null); setCopyMessage(null); }} className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-1 text-muted-foreground transition-[background-color,color,transform] hover:-translate-y-px hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none sm:min-h-8 sm:min-w-8"><X size={14} /></button>
          </div>
          <code className="mt-2 block break-all rounded-md bg-black/20 p-2 font-mono text-[10px] text-foreground">{revealedCallback}</code>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" className={`${SETTINGS_PRIMARY_BUTTON_CLASS} ${BUTTON_MOTION}`} onClick={() => {
              if (!navigator.clipboard) {
                setCopyMessage("Clipboard unavailable — select and copy the callback manually.");
                return;
              }
              void navigator.clipboard.writeText(revealedCallback)
                .then(() => setCopyMessage("Copied."))
                .catch(() => setCopyMessage("Copy failed — select and copy the callback manually."));
            }}>Copy callback</Button>
            {copyMessage ? <FieldHint>{copyMessage}</FieldHint> : null}
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
}
