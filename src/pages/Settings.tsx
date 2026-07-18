import AccountsSettingsSection from "@/components/settings/sections/AccountsSettingsSection";
import ActualBudgetSettingsSection from "@/components/settings/sections/ActualBudgetSettingsSection";
import EmailAutomationSettingsSection from "@/components/settings/sections/EmailAutomationSettingsSection";
import SystemSettingsSection from "@/components/settings/sections/SystemSettingsSection";
import {
  SaveStatus,
  SettingsLayout,
  SkeletonCard,
} from "@/components/settings/settings-ui";
import useSettingsPage from "@/hooks/settings/useSettingsPage";

export default function Settings() {
  const {
    accounts,
    setAccounts,
    settings,
    capabilities,
    refreshCapabilities,
    setSettings,
    loading,
    tab,
    setTab,
    saveStatus,
    patch,
  } = useSettingsPage();

  let content = (
    <>
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
    </>
  );

  if (!loading) {
    if (tab === "accounts") {
      content = (
        <AccountsSettingsSection
          accounts={accounts}
          setAccounts={setAccounts}
          settings={settings}
          patch={patch}
          capabilities={capabilities}
          onRefreshCapabilities={refreshCapabilities}
        />
      );
    } else if (tab === "actual") {
      content = (
        <ActualBudgetSettingsSection
          settings={settings}
          setSettings={setSettings}
          patch={patch}
        />
      );
    } else if (tab === "briefing") {
      content = (
        <EmailAutomationSettingsSection
          settings={settings}
          setSettings={setSettings}
          patch={patch}
        />
      );
    } else {
      content = <SystemSettingsSection />;
    }
  }

  return (
    <SettingsLayout
      activeTab={tab}
      onTabChange={setTab}
      headerAction={<SaveStatus status={saveStatus} />}
    >
      {content}
    </SettingsLayout>
  );
}
