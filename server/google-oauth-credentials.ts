import type { InstanceCredentialService } from "./platform/instance-credential-service.ts";
import { InstanceCredentialConflictError } from "./platform/instance-credential-store.ts";

const CLIENT_ID_KEY = "google.oauth_client_id";
const CLIENT_SECRET_KEY = "google.oauth_client_secret";

export type GoogleOAuthApplicationCredentials = {
  clientId: string;
  clientSecret: string;
};

export type GoogleOAuthCandidateVersions = {
  clientId: number;
  clientSecret: number;
};

export type GoogleOAuthCredentialSelection = {
  credentials: GoogleOAuthApplicationCredentials;
  candidateVersions: GoogleOAuthCandidateVersions | null;
};

export class GoogleOAuthConfigurationError extends Error {
  readonly status = 409;
  readonly code: "GOOGLE_OAUTH_NOT_CONFIGURED" | "GOOGLE_OAUTH_CANDIDATE_INCOMPLETE";

  constructor(code: "GOOGLE_OAUTH_NOT_CONFIGURED" | "GOOGLE_OAUTH_CANDIDATE_INCOMPLETE") {
    super(code === "GOOGLE_OAUTH_NOT_CONFIGURED"
      ? "Google OAuth application credentials are not configured"
      : "Google OAuth application credential candidate is incomplete");
    this.code = code;
  }
}

export function createGoogleOAuthCredentialManager(
  injectedService?: InstanceCredentialService,
) {
  async function service(): Promise<InstanceCredentialService> {
    if (injectedService) return injectedService;
    return (await import("./platform/instance-credential-service.ts")).instanceCredentialService;
  }

  async function resolveActive(): Promise<GoogleOAuthApplicationCredentials> {
    const credentials = await service();
    const [clientId, clientSecret] = await Promise.all([
      credentials.resolve(CLIENT_ID_KEY),
      credentials.resolve(CLIENT_SECRET_KEY),
    ]);
    if (!clientId.value || !clientSecret.value) {
      throw new GoogleOAuthConfigurationError("GOOGLE_OAUTH_NOT_CONFIGURED");
    }
    return { clientId: clientId.value, clientSecret: clientSecret.value };
  }

  async function selectForAuthorization(): Promise<GoogleOAuthCredentialSelection> {
    const credentials = await service();
    const [clientId, clientSecret] = await Promise.all([
      credentials.readPending(CLIENT_ID_KEY),
      credentials.readPending(CLIENT_SECRET_KEY),
    ]);
    if (Boolean(clientId) !== Boolean(clientSecret)) {
      throw new GoogleOAuthConfigurationError("GOOGLE_OAUTH_CANDIDATE_INCOMPLETE");
    }
    if (clientId && clientSecret) {
      return {
        credentials: { clientId: clientId.value, clientSecret: clientSecret.value },
        candidateVersions: { clientId: clientId.version, clientSecret: clientSecret.version },
      };
    }
    return { credentials: await resolveActive(), candidateVersions: null };
  }

  async function stageCandidate(credentials: GoogleOAuthApplicationCredentials) {
    const credentialService = await service();
    const metadata = await credentialService.stagePendingGroup([
      { key: CLIENT_ID_KEY, value: credentials.clientId },
      { key: CLIENT_SECRET_KEY, value: credentials.clientSecret },
    ]);
    return {
      credentials: metadata,
      candidateVersions: {
        clientId: metadata[0]!.version!,
        clientSecret: metadata[1]!.version!,
      },
    };
  }

  async function resolveCandidate(
    candidateVersions: GoogleOAuthCandidateVersions,
  ): Promise<GoogleOAuthApplicationCredentials> {
    const credentials = await service();
    const [clientId, clientSecret] = await Promise.all([
      credentials.readPending(CLIENT_ID_KEY),
      credentials.readPending(CLIENT_SECRET_KEY),
    ]);
    if (!clientId || !clientSecret
      || clientId.version !== candidateVersions.clientId
      || clientSecret.version !== candidateVersions.clientSecret) {
      throw new InstanceCredentialConflictError();
    }
    return { clientId: clientId.value, clientSecret: clientSecret.value };
  }

  async function promoteCandidate(candidateVersions: GoogleOAuthCandidateVersions) {
    const credentials = await service();
    return credentials.promotePendingGroup([
      { key: CLIENT_ID_KEY, expectedVersion: candidateVersions.clientId },
      { key: CLIENT_SECRET_KEY, expectedVersion: candidateVersions.clientSecret },
    ]);
  }

  async function discardCandidate(candidateVersions: GoogleOAuthCandidateVersions) {
    const credentials = await service();
    return credentials.discardPendingGroup([
      { key: CLIENT_ID_KEY, expectedVersion: candidateVersions.clientId },
      { key: CLIENT_SECRET_KEY, expectedVersion: candidateVersions.clientSecret },
    ]);
  }

  async function importEnvironment() {
    const credentials = await service();
    return credentials.importEnvironmentGroup([CLIENT_ID_KEY, CLIENT_SECRET_KEY]);
  }

  async function disable() {
    const credentials = await service();
    return credentials.disableGroup([CLIENT_ID_KEY, CLIENT_SECRET_KEY]);
  }

  async function useHostValues() {
    const credentials = await service();
    return credentials.useHostValueGroup([CLIENT_ID_KEY, CLIENT_SECRET_KEY]);
  }

  return {
    resolveActive,
    selectForAuthorization,
    stageCandidate,
    resolveCandidate,
    promoteCandidate,
    discardCandidate,
    importEnvironment,
    disable,
    useHostValues,
  };
}

export type GoogleOAuthCredentialManager = ReturnType<typeof createGoogleOAuthCredentialManager>;
export const googleOAuthCredentialManager = createGoogleOAuthCredentialManager();
