import { lazy, Suspense, useState } from "react";
import { Mail } from "lucide-react";
import {
  addICloudAccount,
  getAccounts,
  getGmailAuthUrl,
  removeAccount,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { SettingsAccountsProps } from "../settingsTypes";
import { isDemoMode } from "@/demo/config";
import { cn } from "@/lib/utils";

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

const AccountsList = lazy(() => import("@/components/settings/AccountsList"));

export default function ConnectedAccountsCard({ accounts, setAccounts }: SettingsAccountsProps) {
  const demoMode = isDemoMode();
  const [icloudForm, setIcloudForm] = useState({ email: "", password: "", show: false });
  const [icloudError, setIcloudError] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);

  async function handleAddGmail() {
    setGmailError(null);
    try {
      const { url } = await getGmailAuthUrl();
      window.location.href = url;
    } catch (error) {
      setGmailError(errorMessage(error, "Failed to start Gmail authorization"));
    }
  }

  async function handleAddICloud() {
    try {
      setIcloudError(null);
      await addICloudAccount(icloudForm.email, icloudForm.password);
      const refreshedAccounts = await getAccounts();
      setAccounts(Array.isArray(refreshedAccounts) ? refreshedAccounts : refreshedAccounts.accounts);
      setIcloudForm({ email: "", password: "", show: false });
    } catch (error) {
      setIcloudError(errorMessage(error, "Failed to add iCloud account"));
    }
  }

  function handleReconnectICloud(email: string) {
    setIcloudError(null);
    setIcloudForm({ email: email || "", password: "", show: true });
  }

  async function handleRemoveAccount(id: string) {
    try {
      await removeAccount(id);
      setAccounts((current) => current.filter((account) => account.id !== id));
    } catch (error) {
      console.error("Remove account failed:", error);
    }
  }

  return (
    <SettingsCard
      title="Connected Accounts"
      icon={<Mail size={14} />}
      description="Inbox and calendar connections that feed the dashboard and email snapshot pipeline."
    >
      <div className="flex flex-col gap-4">
        {accounts.length > 0 ? (
          <Suspense fallback={<FieldHint>Loading connected accounts…</FieldHint>}>
            <AccountsList
              accounts={accounts}
              setAccounts={setAccounts}
              onRemove={handleRemoveAccount}
              onReconnectGmail={handleAddGmail}
              onReconnectICloud={handleReconnectICloud}
            />
          </Suspense>
        ) : (
          <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground/75">
            No accounts connected yet.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleAddGmail}
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            disabled={demoMode}
          >
            Add Gmail
          </Button>
          <Button
            variant="outline"
            className={cn(
              SETTINGS_SECONDARY_BUTTON_CLASS,
              icloudForm.show && "border-primary/18 bg-primary/[0.08] text-primary"
            )}
            onClick={() => {
              setIcloudForm((current) => ({ ...current, show: !current.show }));
              setIcloudError(null);
            }}
            disabled={demoMode}
          >
            {icloudForm.show ? "Cancel" : "Add iCloud"}
          </Button>
          {demoMode ? <StatusPill tone="neutral">Not available in demo</StatusPill> : null}
        </div>

        {gmailError ? <FieldHint className="text-danger">{gmailError}</FieldHint> : null}

        {icloudForm.show ? (
          <div className="border-t border-white/[0.05] pt-4">
            <div className="mb-3 flex items-center gap-2">
              <StatusPill tone="neutral">iCloud IMAP</StatusPill>
              <span className="text-[11px] text-muted-foreground/75">
                Use an app-specific password from Apple ID settings.
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <SectionLabel>iCloud email</SectionLabel>
                <Input
                  type="email"
                  placeholder="name@icloud.com"
                  value={icloudForm.email}
                  onChange={(event) => {
                    setIcloudError(null);
                    setIcloudForm((current) => ({ ...current, email: event.target.value }));
                  }}
                />
              </div>
              <div>
                <SectionLabel>App-specific password</SectionLabel>
                <Input
                  type="password"
                  placeholder="App-specific password"
                  value={icloudForm.password}
                  onChange={(event) => {
                    setIcloudError(null);
                    setIcloudForm((current) => ({ ...current, password: event.target.value }));
                  }}
                />
              </div>
              {icloudError ? (
                <FieldHint className="text-danger">{icloudError}</FieldHint>
              ) : null}
              <Button
                onClick={handleAddICloud}
                className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, "self-start")}
              >
                Connect iCloud
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
