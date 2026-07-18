import { Router } from "express";
import { requireCookieSession } from "../middleware/auth.ts";
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

  router.put("/google-oauth/pending", requireCookieSession, async (req, res) => {
    const clientId = candidateValue(req.body?.clientId);
    const clientSecret = candidateValue(req.body?.clientSecret);
    if (clientId === null || clientSecret === null) {
      return res.status(400).json({ message: "Google client ID and client secret are required" });
    }
    return res.json(await googleOAuthManager.stageCandidate({ clientId, clientSecret }));
  });

  router.put("/todoist-oauth/pending", requireCookieSession, async (req, res) => {
    const clientId = candidateValue(req.body?.clientId);
    const clientSecret = candidateValue(req.body?.clientSecret);
    if (clientId === null || clientSecret === null) {
      return res.status(400).json({ message: "Todoist client ID and client secret are required" });
    }
    return res.json(await todoistOAuthManager.stageCandidate({ clientId, clientSecret }));
  });

  router.post("/todoist-oauth/import-environment", requireCookieSession, async (_req, res) => {
    return res.json({ credentials: await todoistOAuthManager.importEnvironment() });
  });

  router.get("/gmail-pubsub", requireCookieSession, async (_req, res) => {
    return res.json(await gmailPubSubManager.getStatus());
  });

  router.put("/gmail-pubsub/topic", requireCookieSession, async (req, res) => {
    const value = candidateValue(req.body?.value);
    if (value === null) return res.status(400).json({ message: "Pub/Sub topic is required" });
    return res.json(await gmailPubSubManager.setTopic(value));
  });

  router.post("/gmail-pubsub/generate-callback", requireCookieSession, async (_req, res) => {
    return res.json(await gmailPubSubManager.generateCallback());
  });

  router.post("/gmail-pubsub/import-environment-token", requireCookieSession, async (_req, res) => {
    return res.json(await gmailPubSubManager.importEnvironmentToken());
  });

  router.post("/gmail-pubsub/use-host-token", requireCookieSession, async (_req, res) => {
    return res.json(await gmailPubSubManager.useHostToken());
  });

  router.post("/gmail-pubsub/revoke-token", requireCookieSession, async (_req, res) => {
    return res.json(await gmailPubSubManager.revokeToken());
  });

  router.post("/gmail-pubsub/test-watches", requireCookieSession, async (_req, res) => {
    const result = await gmailPubSubManager.testWatches();
    return res.status(result.ok ? 200 : 422).json(result);
  });

  router.put("/:key/pending", requireCookieSession, async (req, res) => {
    const value = candidateValue(req.body?.value);
    if (value === null) return res.status(400).json({ message: "Credential value is required" });
    return res.json(await service.stagePending(req.params.key!, value));
  });

  router.post("/:key/test", requireCookieSession, async (req, res) => {
    const key = req.params.key!;
    const result = key === "weather.pirate_weather_api_key" || key === "calendar.google_places_api_key"
      ? await locationManager.testPending(key)
      : await aiManager.testPending(key);
    return res.status(result.ok ? 200 : 422).json(result);
  });

  router.post("/:key/import-environment", requireCookieSession, async (req, res) => {
    return res.json(await service.importEnvironment(req.params.key!));
  });

  router.post("/:key/disable", requireCookieSession, async (req, res) => {
    return res.json(await service.disable(req.params.key!));
  });

  router.post("/:key/use-host", requireCookieSession, async (req, res) => {
    return res.json(await service.useHostValue(req.params.key!));
  });

  return router;
}

export default createInstanceCredentialsRouter();
