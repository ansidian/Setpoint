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
) {
  const router = Router();
  wrapRouterAsync(router);

  router.get("/", requireCookieSession, async (_req, res) => {
    return res.json(await service.getMetadata());
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
