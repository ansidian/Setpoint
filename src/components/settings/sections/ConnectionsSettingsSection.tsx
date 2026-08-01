import { useLocation } from "react-router";
import ConnectionPanelContent from "@/components/settings/ConnectionPanelContent";
import ConnectionsDirectory from "@/components/settings/ConnectionsDirectory";
import { connectionSetupTargetFromSearch } from "@/components/settings/connectionDirectoryModel";
import type { ConnectionGroupDefinition, ConnectionRowView } from "@/components/settings/connectionModel";
import type { OnboardingProgress } from "../../../../shared/types/onboarding";
import type {
  SettingsAccountsProps,
  SettingsCredentialMetadataProps,
  SettingsConnectionRefreshProps,
  SettingsState,
  SettingsPatch,
} from "../settingsTypes";

export default function ConnectionsSettingsSection({
  accounts,
  setAccounts,
  settings,
  patch,
  connectionGroups,
  connections,
  onboardingProgress,
  credentialMetadata,
  onCredentialMetadataChange,
  onRefreshCredentialMetadata,
  onRefreshConnections,
}: SettingsAccountsProps & SettingsCredentialMetadataProps & SettingsConnectionRefreshProps & {
  settings: SettingsState | null;
  patch: SettingsPatch;
  connectionGroups: readonly ConnectionGroupDefinition[];
  connections: readonly ConnectionRowView[];
  onboardingProgress: OnboardingProgress | null;
}) {
  const location = useLocation();
  const setupTarget = connectionSetupTargetFromSearch(location.search);

  return (
    <ConnectionsDirectory
      groups={connectionGroups}
      rows={connections}
      onboardingProgress={onboardingProgress}
      renderPanel={(connection) => (
        <ConnectionPanelContent
          connection={connection}
          setupTarget={setupTarget}
          accounts={accounts}
          setAccounts={setAccounts}
          settings={settings}
          patch={patch}
          credentialMetadata={credentialMetadata}
          onCredentialMetadataChange={onCredentialMetadataChange}
          onRefreshCredentialMetadata={onRefreshCredentialMetadata}
          onRefreshConnections={onRefreshConnections}
        />
      )}
    />
  );
}
