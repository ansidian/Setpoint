export type InstanceCredentialHandling = "secret" | "non_secret";

export type InstanceCredentialDefinition = {
  key: string;
  handling: InstanceCredentialHandling;
  envAliases: readonly string[];
  validatorOwner: string;
  capabilities: readonly string[];
};

const DEFINITIONS = [
  { key: "ai.anthropic_api_key", handling: "secret", envAliases: ["ANTHROPIC_API_KEY"], validatorOwner: "ai", capabilities: ["email_triage", "bill_extraction", "alfred"] },
  { key: "ai.openai_api_key", handling: "secret", envAliases: ["OPENAI_API_KEY"], validatorOwner: "ai", capabilities: ["email_triage", "bill_extraction", "semantic_email_search"] },
  { key: "calendar.google_places_api_key", handling: "secret", envAliases: ["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY"], validatorOwner: "calendar", capabilities: ["calendar"] },
  { key: "gmail.pubsub_topic", handling: "non_secret", envAliases: ["GMAIL_PUBSUB_TOPIC"], validatorOwner: "email", capabilities: ["email"] },
  { key: "google.oauth_client_id", handling: "non_secret", envAliases: ["GOOGLE_CLIENT_ID"], validatorOwner: "google", capabilities: ["email", "calendar"] },
  { key: "google.oauth_client_secret", handling: "secret", envAliases: ["GOOGLE_CLIENT_SECRET"], validatorOwner: "google", capabilities: ["email", "calendar"] },
  { key: "tasks.todoist_client_id", handling: "non_secret", envAliases: ["TODOIST_CLIENT_ID"], validatorOwner: "tasks", capabilities: ["tasks"] },
  { key: "tasks.todoist_client_secret", handling: "secret", envAliases: ["TODOIST_CLIENT_SECRET"], validatorOwner: "tasks", capabilities: ["tasks"] },
  { key: "weather.pirate_weather_api_key", handling: "secret", envAliases: ["PIRATE_WEATHER_API_KEY"], validatorOwner: "weather", capabilities: ["weather"] },
] as const satisfies readonly InstanceCredentialDefinition[];

export type InstanceCredentialKey = (typeof DEFINITIONS)[number]["key"];

const DEFINITION_BY_KEY = new Map<string, InstanceCredentialDefinition>(
  DEFINITIONS.map((definition) => [definition.key, definition]),
);

export function listInstanceCredentialDefinitions(): readonly InstanceCredentialDefinition[] {
  return DEFINITIONS;
}

export function getInstanceCredentialDefinition(key: string): InstanceCredentialDefinition | null {
  return DEFINITION_BY_KEY.get(key) ?? null;
}

export function isInstanceCredentialKey(key: string): key is InstanceCredentialKey {
  return DEFINITION_BY_KEY.has(key);
}
