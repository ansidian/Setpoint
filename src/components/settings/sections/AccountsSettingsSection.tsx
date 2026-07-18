import ConnectedAccountsCard from "@/components/settings/cards/ConnectedAccountsCard";
import TodoistCard from "@/components/settings/cards/TodoistCard";
import DiscordRemindersCard from "@/components/settings/cards/DiscordRemindersCard";
import WeatherLocationCard from "@/components/settings/cards/WeatherLocationCard";
import CoreProviderCredentialsCard from "@/components/settings/cards/CoreProviderCredentialsCard";
import GoogleOAuthCredentialsCard from "@/components/settings/cards/GoogleOAuthCredentialsCard";
import { CloudSun } from "lucide-react";
import type { SettingsAccountsProps, SettingsCardStateProps } from "../settingsTypes";

export default function AccountsSettingsSection({ accounts, setAccounts, settings, patch }: SettingsAccountsProps & Pick<SettingsCardStateProps, "settings" | "patch">) {
  return (
    <>
      <ConnectedAccountsCard accounts={accounts} setAccounts={setAccounts} />
      <GoogleOAuthCredentialsCard />
      <TodoistCard settings={settings} />
      <DiscordRemindersCard settings={settings} />
      <CoreProviderCredentialsCard
        title="Location provider credentials"
        icon={<CloudSun size={14} />}
        description="Runtime keys for dashboard forecasts and optional Calendar place suggestions."
        credentials={[
          {
            key: "weather.pirate_weather_api_key",
            label: "Pirate Weather",
            inputLabel: "Pirate Weather API key",
            placeholder: "Enter a new API key",
            help: "Required for dashboard forecasts. Location lookup remains keyless.",
          },
          {
            key: "calendar.google_places_api_key",
            label: "Google Places",
            inputLabel: "Google Places API key",
            placeholder: "Enter a new API key",
            help: "Optional Calendar enhancement for place autocomplete and details.",
          },
        ]}
      />
      <WeatherLocationCard settings={settings} patch={patch} />
    </>
  );
}
