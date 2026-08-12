import { useState } from "react";
import { Image, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/settings-ui";
import {
  SETTINGS_SECONDARY_BUTTON_CLASS,
  SURFACE_ROW_CLASS,
} from "@/components/settings/settings-core";
import { useRemoteContentTrustRegistry } from "@/hooks/useRemoteContentTrust";
import { cn } from "@/lib/utils";

export default function TrustedRemoteContentCard() {
  const { entries, loading, error, reload, removeTrust } = useRemoteContentTrustRegistry();
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleRemove(id: number) {
    setRemovingId(id);
    setRemoveError(null);
    try {
      await removeTrust(id);
    } catch (caught) {
      setRemoveError(caught instanceof Error && caught.message
        ? caught.message
        : "Could not remove this trusted sender. Try again.");
    } finally {
      setRemovingId((current) => current === id ? null : current);
    }
  }

  return (
    <SettingsCard
      title="Remote Content"
      icon={<Image size={14} />}
      description="Remote images load automatically only for these exact sender and receiving-account pairs."
    >
      <div className="flex flex-col gap-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 py-3 text-[12px] text-muted-foreground/75">
            <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
            Loading trusted senders…
          </div>
        ) : null}

        {!loading && error ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-danger/20 bg-danger/[0.06] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
            <Button
              type="button"
              size="sm"
              className={SETTINGS_SECONDARY_BUTTON_CLASS}
              onClick={() => void reload()}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {!loading && !error && entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground/75">
            No trusted senders yet. Open an email with blocked images and choose Show once, then confirm the sender.
          </div>
        ) : null}

        {!loading && entries.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-white/[0.06]">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={cn(SURFACE_ROW_CLASS, "flex items-center justify-between gap-3 px-3 py-3")}
              >
                <div className="min-w-0">
                  <div className="break-all text-[13px] font-medium text-foreground/90">
                    {entry.sender_address}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground/75">
                    Received by {entry.account_label || entry.account_email}
                    {entry.account_label && entry.account_email ? ` · ${entry.account_email}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={removingId === entry.id}
                  onClick={() => void handleRemove(entry.id)}
                  className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground/55 transition-[background-color,border-color,color,transform,opacity] hover:-translate-y-px hover:border-danger/20 hover:bg-danger/[0.08] hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 active:translate-y-0 disabled:cursor-wait disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none"
                  aria-label={`Remove trusted sender ${entry.sender_address} for ${entry.account_label || entry.account_email}`}
                  title="Remove trusted sender"
                >
                  {removingId === entry.id
                    ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
                    : <X size={13} />}
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {removeError ? (
          <p role="alert" className="text-[11px] text-danger">
            {removeError}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
