import { lazy, Suspense, useState } from "react";
import { Mail } from "lucide-react";
import { getGmailAuthUrl, removeAccount } from "@/api";
import { isDemoMode } from "@/demo/config";
import { Button } from "@/components/ui/button";
import { FieldHint, SettingsCard, StatusPill } from "@/components/settings/settings-ui";
import { SETTINGS_PRIMARY_BUTTON_CLASS } from "@/components/settings/settings-core";
import type { SettingsAccountsProps } from "../settingsTypes";

const AccountsList = lazy(() => import("@/components/settings/AccountsList"));
const BUTTON_MOTION = "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : "Failed to start Google authorization";

export default function GoogleWorkspaceAccountsPanel({ accounts, setAccounts }: SettingsAccountsProps) {
  const demoMode = isDemoMode();
  const [error, setError] = useState<string | null>(null);
  const googleAccounts = accounts.filter(({ type }) => type === "gmail");

  async function handleAddGoogleAccount() {
    setError(null);
    try {
      const { url } = await getGmailAuthUrl();
      window.location.href = url;
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function handleRemoveAccount(id: string) {
    try {
      await removeAccount(id);
      setAccounts((current) => current.filter((account) => account.id !== id));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <SettingsCard
      title="Google accounts"
      icon={<Mail size={14} />}
      description="Authorized Gmail and Calendar identities using this Google application."
    >
      <div className="flex flex-col gap-4">
        {googleAccounts.length ? (
          <Suspense fallback={<div data-settings-content-loading=""><FieldHint>Loading Google accounts…</FieldHint></div>}>
            <AccountsList
              accounts={accounts}
              accountType="gmail"
              setAccounts={setAccounts}
              onRemove={handleRemoveAccount}
              onReconnectGmail={handleAddGoogleAccount}
            />
          </Suspense>
        ) : (
          <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground">
            No Google accounts connected yet.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleAddGoogleAccount}
            className={`${SETTINGS_PRIMARY_BUTTON_CLASS} ${BUTTON_MOTION}`}
            disabled={demoMode}
          >
            Add Google account
          </Button>
          {demoMode ? <StatusPill tone="neutral">Not available in demo</StatusPill> : null}
        </div>
        {error ? <FieldHint className="text-danger">{error}</FieldHint> : null}
      </div>
    </SettingsCard>
  );
}
