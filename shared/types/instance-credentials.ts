export type InstanceCredentialSource = "stored" | "environment" | "disabled" | "absent";
export type InstanceCredentialValidationState = "untested" | "pending" | "valid" | "invalid" | "disabled";

export type InstanceCredentialMetadata = {
  key: string;
  handling: "secret" | "non_secret";
  capabilities: string[];
  source: InstanceCredentialSource;
  activeConfigured: boolean;
  pendingConfigured: boolean;
  pendingStagedAt: number | null;
  pendingExpiresAt: number | null;
  validationState: InstanceCredentialValidationState;
  lastTestedAt: number | null;
  lastSucceededAt: number | null;
  lastFailedAt: number | null;
  errorCode: string | null;
  version: number | null;
};

export type RootKeyHealthMetadata = {
  configured: boolean;
  valid: boolean;
  fingerprint: string | null;
  decryptability: "ok" | "unavailable" | "failed";
};

export type InstanceCredentialMetadataResponse = {
  credentials: InstanceCredentialMetadata[];
  rootKey: RootKeyHealthMetadata;
};
