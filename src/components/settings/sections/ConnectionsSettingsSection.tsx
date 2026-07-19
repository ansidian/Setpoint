import ConnectionPanelContent from "@/components/settings/ConnectionPanelContent";
import ConnectionsDirectory from "@/components/settings/ConnectionsDirectory";
import type { ConnectionGroupDefinition, ConnectionRowView } from "@/components/settings/connectionModel";
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
  credentialMetadata,
  onCredentialMetadataChange,
  onRefreshCredentialMetadata,
  onRefreshConnections,
}: SettingsAccountsProps & SettingsCredentialMetadataProps & SettingsConnectionRefreshProps & {
  settings: SettingsState | null;
  patch: SettingsPatch;
  connectionGroups: readonly ConnectionGroupDefinition[];
  connections: readonly ConnectionRowView[];
}) {
  return (
    <ConnectionsDirectory
      groups={connectionGroups}
      rows={connections}
      renderPanel={(connection) => (
        <ConnectionPanelContent
          connection={connection}
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
