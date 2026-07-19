import { lazy, Suspense } from "react";
import { CloudSun, KeyRound, MapPin } from "lucide-react";
import ActualBudgetConnectionCard from "@/components/settings/cards/ActualBudgetConnectionCard";
import CoreProviderCredentialsCard from "@/components/settings/cards/CoreProviderCredentialsCard";
import DiscordRemindersCard from "@/components/settings/cards/DiscordRemindersCard";
import GoogleOAuthCredentialsCard from "@/components/settings/cards/GoogleOAuthCredentialsCard";
import GoogleWorkspaceAccountsPanel from "@/components/settings/cards/GoogleWorkspaceAccountsPanel";
import ICloudMailAccountsPanel from "@/components/settings/cards/ICloudMailAccountsPanel";
import TodoistCard from "@/components/settings/cards/TodoistCard";
import WeatherLocationCard from "@/components/settings/cards/WeatherLocationCard";
import { FieldHint, StatusPill } from "@/components/settings/settings-ui";
import type { ConnectionRowView, ConnectionState } from "./connectionModel";
import type { ConnectionSetupTarget } from "./connectionDirectoryModel";
import type {
  SettingsAccountsProps,
  SettingsCredentialMetadataProps,
  SettingsConnectionRefreshProps,
  SettingsState,
  SettingsPatch,
} from "./settingsTypes";

const GmailRealtimeCard = lazy(() => import("@/components/settings/cards/GmailRealtimeCard"));

type ConnectionPanelContentProps = SettingsAccountsProps & SettingsCredentialMetadataProps & SettingsConnectionRefreshProps & {
  connection: ConnectionRowView;
  setupTarget?: ConnectionSetupTarget | null;
  settings: SettingsState | null;
  patch: SettingsPatch;
};

function toneForState(state: ConnectionState | null) {
  if (state === "connected") return "success" as const;
  if (state === "needs_attention") return "warning" as const;
  if (state === "needs_setup") return "accent" as const;
  return "neutral" as const;
}

function formatEvidenceTimestamp(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function formatConnectionSource(source: ConnectionRowView["source"]) {
  if (source === "stored" || source === "settings") return "Saved in Setpoint";
  if (source === "environment") return "Environment";
  if (source === "disabled") return "Disabled";
  if (source === "mixed") return "Mixed";
  return "Not configured";
}

export default function ConnectionPanelContent({
  connection,
  setupTarget = null,
  accounts,
  setAccounts,
  settings,
  patch,
  credentialMetadata,
  onCredentialMetadataChange,
  onRefreshCredentialMetadata,
  onRefreshConnections,
}: ConnectionPanelContentProps) {
  const lastVerified = formatEvidenceTimestamp(connection.lastSucceededAt ?? connection.lastTestedAt);
  const credentialProps = {
    credentialMetadata,
    onCredentialMetadataChange,
    onRefreshCredentialMetadata,
  };

  let controls = null;
  switch (connection.id) {
    case "google-workspace":
      controls = (
        <>
          <GoogleOAuthCredentialsCard {...credentialProps} />
          <GoogleWorkspaceAccountsPanel accounts={accounts} setAccounts={setAccounts} />
          <Suspense fallback={<div data-settings-content-loading="" aria-hidden="true" />}>
            <GmailRealtimeCard openAdvancedSetup={setupTarget === "gmail-realtime"} />
          </Suspense>
        </>
      );
      break;
    case "icloud-mail":
      controls = <ICloudMailAccountsPanel accounts={accounts} setAccounts={setAccounts} />;
      break;
    case "todoist":
      controls = (
        <TodoistCard
          settings={settings}
          onRefreshConnections={onRefreshConnections}
          openAdvancedSetup={setupTarget === "todoist-advanced"}
        />
      );
      break;
    case "actual-budget":
      controls = <ActualBudgetConnectionCard settings={settings} onRefreshConnections={onRefreshConnections} />;
      break;
    case "openai":
      controls = (
        <CoreProviderCredentialsCard
          title="OpenAI credentials"
          icon={<KeyRound size={14} />}
          description="Write-only API key used by OpenAI-backed Setpoint features."
          credentials={[{
            key: "ai.openai_api_key",
            label: "OpenAI",
            inputLabel: "OpenAI API key",
            placeholder: "Enter a new API key",
            help: "Enables OpenAI-backed triage, bill extraction, semantic email search, and configured fallbacks.",
          }]}
          {...credentialProps}
        />
      );
      break;
    case "anthropic":
      controls = (
        <CoreProviderCredentialsCard
          title="Anthropic credentials"
          icon={<KeyRound size={14} />}
          description="Write-only API key used by Anthropic-backed Setpoint features."
          credentials={[{
            key: "ai.anthropic_api_key",
            label: "Anthropic",
            inputLabel: "Anthropic API key",
            placeholder: "Enter a new API key",
            help: "Enables Anthropic-backed triage, bill extraction, Alfred, and configured fallbacks.",
          }]}
          {...credentialProps}
        />
      );
      break;
    case "discord-reminders":
      controls = <DiscordRemindersCard settings={settings} onRefreshConnections={onRefreshConnections} />;
      break;
    case "pirate-weather":
      controls = (
        <>
          <CoreProviderCredentialsCard
            title="Pirate Weather credentials"
            icon={<CloudSun size={14} />}
            description="Write-only provider key for dashboard forecasts."
            credentials={[{
              key: "weather.pirate_weather_api_key",
              label: "Pirate Weather",
              inputLabel: "Pirate Weather API key",
              placeholder: "Enter a new API key",
              help: "Required for dashboard forecasts. Location lookup remains keyless.",
            }]}
            {...credentialProps}
          />
          <WeatherLocationCard settings={settings} patch={patch} />
        </>
      );
      break;
    case "google-places":
      controls = (
        <CoreProviderCredentialsCard
          title="Google Places credentials"
          icon={<MapPin size={14} />}
          description="Write-only key for optional Calendar place suggestions and details."
          credentials={[{
            key: "calendar.google_places_api_key",
            label: "Google Places",
            inputLabel: "Google Places API key",
            placeholder: "Enter a new API key",
            help: "Optional Calendar enhancement for place autocomplete and details.",
          }]}
          {...credentialProps}
        />
      );
      break;
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={toneForState(connection.state)}>{connection.statusLabel}</StatusPill>
            {connection.identities.length ? (
              <span className="text-[11px] text-muted-foreground">{connection.identities.join(", ")}</span>
            ) : null}
          </div>
          {lastVerified ? <FieldHint className="mt-1">Last verified {lastVerified}</FieldHint> : null}
          <FieldHint className="mt-1">Source: {formatConnectionSource(connection.source)}</FieldHint>
        </div>
      </div>
      {controls}
    </div>
  );
}
