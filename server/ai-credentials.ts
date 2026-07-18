import type { InstanceCredentialMetadata } from "../shared/types/instance-credentials.ts";
import type { InstanceCredentialService } from "./platform/instance-credential-service.ts";

export type AiProvider = "openai" | "anthropic";
export type AiCredentialKey = "ai.openai_api_key" | "ai.anthropic_api_key";
export type AiCredentialTestCode =
  | "VALID"
  | "INVALID_CREDENTIAL"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "VALIDATION_FAILED";

type ValidationResponse = { ok: boolean; status: number };
type ValidationFetch = (input: string | URL | Request, init?: RequestInit) => Promise<ValidationResponse>;

export class UnknownAiCredentialError extends Error {
  readonly code = "UNKNOWN_AI_CREDENTIAL";
  readonly status = 404;

  constructor() {
    super("AI credential key is not supported");
  }
}

export class MissingPendingAiCredentialError extends Error {
  readonly code = "AI_CREDENTIAL_PENDING_REQUIRED";
  readonly status = 409;

  constructor() {
    super("A pending AI credential is required");
  }
}

export function aiCredentialKey(provider: AiProvider): AiCredentialKey {
  return provider === "openai" ? "ai.openai_api_key" : "ai.anthropic_api_key";
}

async function runtimeCredentialService(): Promise<InstanceCredentialService> {
  return (await import("./platform/instance-credential-service.ts")).instanceCredentialService;
}

function requireAiCredentialKey(key: string): AiCredentialKey {
  if (key !== "ai.openai_api_key" && key !== "ai.anthropic_api_key") {
    throw new UnknownAiCredentialError();
  }
  return key;
}

export async function resolveAiApiKey(
  provider: AiProvider,
  credentials?: Pick<InstanceCredentialService, "resolve">,
): Promise<string | null> {
  const service = credentials ?? await runtimeCredentialService();
  return (await service.resolve(aiCredentialKey(provider))).value;
}

export async function getAiCredentialMetadata(
  provider: AiProvider,
  credentials?: Pick<InstanceCredentialService, "getCredentialMetadata">,
): Promise<InstanceCredentialMetadata> {
  const service = credentials ?? await runtimeCredentialService();
  return service.getCredentialMetadata(aiCredentialKey(provider));
}

function validationRequest(key: AiCredentialKey, value: string): { url: string; init: RequestInit } {
  if (key === "ai.openai_api_key") {
    return {
      url: "https://api.openai.com/v1/models",
      init: { method: "GET", headers: { Authorization: `Bearer ${value}` } },
    };
  }
  return {
    url: "https://api.anthropic.com/v1/models?limit=1",
    init: {
      method: "GET",
      headers: {
        "x-api-key": value,
        "anthropic-version": "2023-06-01",
      },
    },
  };
}

function validationCode(status: number): AiCredentialTestCode {
  if (status === 401 || status === 403) return "INVALID_CREDENTIAL";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "VALIDATION_FAILED";
}

export function createAiCredentialManager({
  credentials,
  fetchImpl = globalThis.fetch,
}: {
  credentials?: InstanceCredentialService;
  fetchImpl?: ValidationFetch;
} = {}) {
  async function testPending(keyInput: string): Promise<{
    ok: boolean;
    code: AiCredentialTestCode;
    metadata: InstanceCredentialMetadata;
  }> {
    const key = requireAiCredentialKey(keyInput);
    const service = credentials ?? await runtimeCredentialService();
    const pending = await service.readPending(key);
    if (!pending) throw new MissingPendingAiCredentialError();

    let code: AiCredentialTestCode = "PROVIDER_UNAVAILABLE";
    try {
      const request = validationRequest(key, pending.value);
      const response = await fetchImpl(request.url, request.init);
      if (response.ok) {
        const metadata = await service.promotePending(key, pending.version);
        return { ok: true, code: "VALID", metadata };
      }
      code = validationCode(response.status);
    } catch {
      code = "PROVIDER_UNAVAILABLE";
    }

    const metadata = await service.recordPendingFailure(key, pending.version, code);
    return { ok: false, code, metadata };
  }

  return { testPending };
}

export type AiCredentialManager = ReturnType<typeof createAiCredentialManager>;
export const aiCredentialManager = createAiCredentialManager();
