import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { getImportantSenders, updateImportantSenders } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SURFACE_ROW_CLASS,
} from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";

export default function ImportantSendersCard() {
  const [importantSenders, setImportantSenders] = useState([]);
  const [senderSaving, setSenderSaving] = useState(false);
  const [senderError, setSenderError] = useState(null);

  useEffect(() => {
    getImportantSenders().then((senders) => setImportantSenders(senders || [])).catch(() => {});
  }, []);

  async function persistSenders(nextSenders) {
    const prevSenders = importantSenders;
    setImportantSenders(nextSenders);
    setSenderSaving(true);
    setSenderError(null);
    try {
      await updateImportantSenders(nextSenders);
    } catch (err) {
      // Roll back the optimistic update and surface the failure instead of
      // diverging silently from the server (this list drives notifications).
      setImportantSenders(prevSenders);
      setSenderError(err?.message || "Could not save important senders.");
    } finally {
      setSenderSaving(false);
    }
  }

  return (
    <SettingsCard
      title="Important Senders"
      icon={<BellRing size={14} />}
      description="Send browser notifications for these senders. Auto-detected entries are learned from triage urgency."
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {importantSenders.map((sender, index) => (
            <div
              key={sender.address}
              className={cn(
                SURFACE_ROW_CLASS,
                "flex items-center justify-between gap-3 px-3 py-3"
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-foreground/90">
                    {sender.name || sender.address}
                  </span>
                  {sender.source === "auto" ? (
                    <StatusPill tone="neutral">(auto)</StatusPill>
                  ) : null}
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground/55">
                  {sender.address}
                </div>
              </div>
              <button
                type="button"
                className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:bg-white/[0.04] hover:text-danger"
                onClick={() => {
                  const nextSenders = importantSenders.filter((_, currentIndex) => currentIndex !== index);
                  persistSenders(nextSenders);
                }}
                title="Remove"
              >
                <X size={13} />
              </button>
            </div>
          ))}

          {importantSenders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] italic text-muted-foreground/55">
              No important senders yet. Add one below or let future triage runs learn them automatically.
            </div>
          ) : null}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.target.elements.senderEmail;
            const address = input.value.trim().toLowerCase();
            if (!address) return;
            if (importantSenders.some((sender) => sender.address === address)) {
              input.value = "";
              return;
            }
            const nextSenders = [
              ...importantSenders,
              { address, name: address.split("@")[0], source: "manual" },
            ];
            input.value = "";
            persistSenders(nextSenders);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Input name="senderEmail" placeholder="e.g. boss@company.com" className="flex-1" />
          <Button
            type="submit"
            size="sm"
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            disabled={senderSaving}
          >
            {senderSaving ? "Saving…" : "Add"}
          </Button>
        </form>

        {senderError ? (
          <p className="text-[11px] text-danger" role="alert">
            {senderError}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
