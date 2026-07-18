import { describe, expect, it } from "vitest";
import {
  getInstanceCredentialDefinition,
  listInstanceCredentialDefinitions,
} from "./instance-credential-registry.ts";

describe("instance credential registry", () => {
  it("allowlists the deployment-wide credentials needed by provider children", () => {
    expect(listInstanceCredentialDefinitions().map((definition) => definition.key)).toEqual([
      "ai.anthropic_api_key",
      "ai.openai_api_key",
      "calendar.google_places_api_key",
      "gmail.pubsub_topic",
      "google.oauth_client_id",
      "google.oauth_client_secret",
      "tasks.todoist_client_id",
      "tasks.todoist_client_secret",
      "weather.pirate_weather_api_key",
    ]);
  });

  it("declares handling, env aliases, validator ownership, and affected capabilities", () => {
    expect(getInstanceCredentialDefinition("calendar.google_places_api_key")).toEqual({
      key: "calendar.google_places_api_key",
      handling: "secret",
      envAliases: ["GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY"],
      validatorOwner: "calendar",
      capabilities: ["calendar"],
    });
  });

  it("does not resolve unknown keys", () => {
    expect(getInstanceCredentialDefinition("arbitrary.secret")).toBeNull();
  });
});
