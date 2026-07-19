import { lazy, Suspense, useState } from "react";
import { Cloud } from "lucide-react";
import { addICloudAccount, getAccounts, removeAccount } from "@/api";
import { isDemoMode } from "@/demo/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FieldHint, SectionLabel, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from "@/components/settings/settings-core";
import type { SettingsAccountsProps } from "../settingsTypes";

const AccountsList = lazy(() => import("@/components/settings/AccountsList"));
const BUTTON_MOTION = "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export default function ICloudMailAccountsPanel({ accounts, setAccounts }: SettingsAccountsProps) {
  const demoMode = isDemoMode();
  const [form, setForm] = useState({ email: "", password: "", show: false });
  const [error, setError] = useState<string | null>(null);
  const icloudAccounts = accounts.filter(({ type }) => type === "icloud");

  function closeForm() {
    setForm({ email: "", password: "", show: false });
    setError(null);
  }

  async function handleConnect() {
    try {
      setError(null);
      await addICloudAccount(form.email, form.password);
      const refreshed = await getAccounts();
      setAccounts(Array.isArray(refreshed) ? refreshed : refreshed.accounts);
      closeForm();
    } catch (caught) {
      setError(errorMessage(caught, "Failed to add iCloud account"));
    }
  }

  async function handleRemoveAccount(id: string) {
    try {
      await removeAccount(id);
      setAccounts((current) => current.filter((account) => account.id !== id));
    } catch (caught) {
      setError(errorMessage(caught, "Failed to remove iCloud account"));
    }
  }

  return (
    <SettingsCard
      title="iCloud accounts"
      icon={<Cloud size={14} />}
      description="Mail identities connected with an Apple app-specific password."
    >
      <div className="flex flex-col gap-4">
        {icloudAccounts.length ? (
          <Suspense fallback={<div data-settings-content-loading=""><FieldHint>Loading iCloud accounts…</FieldHint></div>}>
            <AccountsList
              accounts={accounts}
              accountType="icloud"
              setAccounts={setAccounts}
              onRemove={handleRemoveAccount}
              onReconnectICloud={(email) => {
                setError(null);
                setForm({ email, password: "", show: true });
              }}
            />
          </Suspense>
        ) : (
          <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground">
            No iCloud accounts connected yet.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION, form.show && "border-primary/20 bg-primary/[0.08] text-primary")}
            onClick={() => form.show ? closeForm() : setForm({ email: "", password: "", show: true })}
            disabled={demoMode}
          >
            {form.show ? "Cancel" : "Add iCloud account"}
          </Button>
          {demoMode ? <StatusPill tone="neutral">Not available in demo</StatusPill> : null}
        </div>

        {form.show ? (
          <div className="border-t border-white/[0.06] pt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusPill tone="neutral">iCloud IMAP</StatusPill>
              <FieldHint>Use an app-specific password from Apple ID settings.</FieldHint>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <SectionLabel htmlFor="icloud-connection-email">iCloud email</SectionLabel>
                <Input
                  id="icloud-connection-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@icloud.com"
                  value={form.email}
                  onChange={(event) => {
                    setError(null);
                    setForm((current) => ({ ...current, email: event.target.value }));
                  }}
                />
              </div>
              <div>
                <SectionLabel htmlFor="icloud-connection-password">App-specific password</SectionLabel>
                <Input
                  id="icloud-connection-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="App-specific password"
                  value={form.password}
                  onChange={(event) => {
                    setError(null);
                    setForm((current) => ({ ...current, password: event.target.value }));
                  }}
                />
              </div>
              {error ? <FieldHint className="text-danger">{error}</FieldHint> : null}
              <Button
                onClick={handleConnect}
                className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION, "self-start")}
                disabled={!form.email.trim() || !form.password}
              >
                Connect iCloud
              </Button>
            </div>
          </div>
        ) : error ? <FieldHint className="text-danger">{error}</FieldHint> : null}
      </div>
    </SettingsCard>
  );
}
