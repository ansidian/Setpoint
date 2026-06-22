import ConnectedAccountsCard from "@/components/settings/cards/ConnectedAccountsCard";
import TodoistCard from "@/components/settings/cards/TodoistCard";
import DiscordRemindersCard from "@/components/settings/cards/DiscordRemindersCard";
import WeatherLocationCard from "@/components/settings/cards/WeatherLocationCard";

export default function AccountsSettingsSection({ accounts, setAccounts, settings, patch }) {
  return (
    <>
      <ConnectedAccountsCard accounts={accounts} setAccounts={setAccounts} />
      <TodoistCard settings={settings} />
      <DiscordRemindersCard settings={settings} />
      <WeatherLocationCard settings={settings} patch={patch} />
    </>
  );
}
