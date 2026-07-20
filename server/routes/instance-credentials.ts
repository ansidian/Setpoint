import { Router } from "express";
import type { Response } from "express";
import { requireCookieSession, requireRecentPasswordAuth } from "../middleware/auth.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";
import {
  instanceCredentialService,
  type InstanceCredentialService,
} from "../platform/instance-credential-service.ts";
import {
  aiCredentialManager,
  type AiCredentialManager,
} from "../ai-credentials.ts";
import {
  locationCredentialManager,
  type LocationCredentialManager,
} from "../location-credentials.ts";
import {
  googleOAuthCredentialManager,
  type GoogleOAuthCredentialManager,
} from "../google-oauth-credentials.ts";
import {
  gmailPubSubService,
  type GmailPubSubService,
} from "../email/gmail-pubsub.ts";
import {
  todoistOAuthCredentialManager,
  type TodoistOAuthCredentialManager,
} from "../tasks/todoist-setup.ts";

const MAX_CREDENTIAL_LENGTH = 65_536;

function candidateValue(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_CREDENTIAL_LENGTH) {
    return null;
  }
  return value;
}

const PROVIDER_OWNED_GROUP_KEYS = new Set([
  "google.oauth_client_id",
  "google.oauth_client_secret",
  "tasks.todoist_client_id",
  "tasks.todoist_client_secret",
]);

function rejectGenericGroupMutation(key: string, res: Response): boolean {
  if (!PROVIDER_OWNED_GROUP_KEYS.has(key)) return false;
  res.status(409).json({
    code: "CREDENTIAL_GROUP_ACTION_REQUIRED",
    message: "Use the provider-owned credential-pair action",
  });
  return true;
}

export function createInstanceCredentialsRouter(
  service: InstanceCredentialService = instanceCredentialService,
  aiManager: AiCredentialManager = aiCredentialManager,
  locationManager: LocationCredentialManager = locationCredentialManager,
  googleOAuthManager: GoogleOAuthCredentialManager = googleOAuthCredentialManager,
  gmailPubSubManager: GmailPubSubService = gmailPubSubService,
  todoistOAuthManager: TodoistOAuthCredentialManager = todoistOAuthCredentialManager,
) {
  const router = Router();
  wrapRouterAsync(router);

  router.get("/", requireCookieSession, async (_req, res) => {
    return res.json(await service.getMetadata());
  });

  router.put("/google-oauth/pending", requireRecentPasswordAuth, async (req, res) => {
    const clientId = candidateValue(req.body?.clientId);
    const clientSecret = candidateValue(req.body?.clientSecret);
    if (clientId === null || clientSecret === null) {
      return res.status(400).json({ message: "Google client ID and client secret are required" });
    }
    return res.json(await googleOAuthManager.stageCandidate({ clientId, clientSecret }));
  });

  router.post("/google-oauth/import-environment", requireRecentPasswordAuth, async (_req, res) => {
    return res.json({ credentials: await googleOAuthManager.importEnvironment() });
  });

  router.post("/google-oauth/disable", requireRecentPasswordAuth, async (_req, res) => {
    return res.json({ credentials: await googleOAuthManager.disable() });
  });

  router.post("/google-oauth/use-host", requireRecentPasswordAuth, async (_req, res) => {
    return res.json({ credentials: await googleOAuthManager.useHostValues() });
  });

  router.put("/todoist-oauth/pending", requireRecentPasswordAuth, async (req, res) => {
    const clientId = candidateValue(req.body?.clientId);
    const clientSecret = candidateValue(req.body?.clientSecret);
    if (clientId === null || clientSecret === null) {
      return res.status(400).json({ message: "Todoist client ID and client secret are required" });
    }
    return res.json(await todoistOAuthManager.stageCandidate({ clientId, clientSecret }));
  });

  router.post("/todoist-oauth/import-environment", requireRecentPasswordAuth, async (_req, res) => {
    return res.json({ credentials: await todoistOAuthManager.importEnvironment() });
  });

  router.get("/gmail-pubsub", requireCookieSession, async (_req, res) => {
    return res.json(await gmailPubSubManager.getStatus());
  });

  router.put("/gmail-pubsub/topic", requireRecentPasswordAuth, async (req, res) => {
    const value = candidateValue(req.body?.value);
    if (value === null) return res.status(400).json({ message: "Pub/Sub topic is required" });
    return res.json(await gmailPubSubManager.setTopic(value));
  });

  router.post("/gmail-pubsub/generate-callback", requireRecentPasswordAuth, async (_req, res) => {
    return res.json(await gmailPubSubManager.generateCallback());
  });

  router.post("/gmail-pubsub/import-environment-token", requireRecentPasswordAuth, async (_req, res) => {
    return res.json(await gmailPubSubManager.importEnvironmentToken());
  });

  router.post("/gmail-pubsub/use-host-token", requireRecentPasswordAuth, async (_req, res) => {
    return res.json(await gmailPubSubManager.useHostToken());
  });

  router.post("/gmail-pubsub/revoke-token", requireRecentPasswordAuth, async (_req, res) => {
    return res.json(await gmailPubSubManager.revokeToken());
  });

  router.post("/gmail-pubsub/test-watches", requireRecentPasswordAuth, async (_req, res) => {
    const result = await gmailPubSubManager.testWatches();
    return res.status(result.ok ? 200 : 422).json(result);
  });

  router.put("/:key/pending", requireRecentPasswordAuth, async (req, res) => {
    if (rejectGenericGroupMutation(req.params.key!, res)) return;
    const value = candidateValue(req.body?.value);
    if (value === null) return res.status(400).json({ message: "Credential value is required" });
    return res.json(await service.stagePending(req.params.key!, value));
  });

  router.post("/:key/test", requireRecentPasswordAuth, async (req, res) => {
    const key = req.params.key!;
    if (rejectGenericGroupMutation(key, res)) return;
    const result = key === "weather.pirate_weather_api_key" || key === "calendar.google_places_api_key"
      ? await locationManager.testPending(key)
      : await aiManager.testPending(key);
    return res.status(result.ok ? 200 : 422).json(result);
  });

  router.post("/:key/import-environment", requireRecentPasswordAuth, async (req, res) => {
    if (rejectGenericGroupMutation(req.params.key!, res)) return;
    return res.json(await service.importEnvironment(req.params.key!));
  });

  router.post("/:key/disable", requireRecentPasswordAuth, async (req, res) => {
    if (rejectGenericGroupMutation(req.params.key!, res)) return;
    return res.json(await service.disable(req.params.key!));
  });

  router.post("/:key/use-host", requireRecentPasswordAuth, async (req, res) => {
    if (rejectGenericGroupMutation(req.params.key!, res)) return;
    return res.json(await service.useHostValue(req.params.key!));
  });

  return router;
}

export default createInstanceCredentialsRouter();
