import ConnectedAccountsCard from "@/components/settings/cards/ConnectedAccountsCard";
import TodoistCard from "@/components/settings/cards/TodoistCard";
import DiscordRemindersCard from "@/components/settings/cards/DiscordRemindersCard";
import WeatherLocationCard from "@/components/settings/cards/WeatherLocationCard";
import type { SettingsAccountsProps, SettingsCardStateProps } from "../settingsTypes";

export default function AccountsSettingsSection({ accounts, setAccounts, settings, patch }: SettingsAccountsProps & Pick<SettingsCardStateProps, "settings" | "patch">) {
  return (
    <>
      <ConnectedAccountsCard accounts={accounts} setAccounts={setAccounts} />
      <TodoistCard settings={settings} />
      <DiscordRemindersCard settings={settings} />
      <WeatherLocationCard settings={settings} patch={patch} />
    </>
  );
}
