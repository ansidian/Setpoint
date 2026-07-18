import type {
  InstanceCredentialMetadata,
  InstanceCredentialMetadataResponse,
  InstanceCredentialSource,
  RootKeyHealthMetadata,
} from "../../shared/types/instance-credentials.ts";
import {
  createEncryption,
  getRootKeyHealth,
} from "./encryption.ts";
import {
  getInstanceCredentialDefinition,
  listInstanceCredentialDefinitions,
  type InstanceCredentialKey,
} from "./instance-credential-registry.ts";
import {
  instanceCredentialStore,
  type InstanceCredentialRecord,
  type InstanceCredentialStore,
} from "./instance-credential-store.ts";
import { rootKeyHealthService } from "./root-key-health.ts";

export type ResolvedInstanceCredential = {
  key: InstanceCredentialKey;
  source: InstanceCredentialSource;
  value: string | null;
};

export type InstanceCredentialChangeEvent = {
  key: InstanceCredentialKey;
  reason: "pending_staged" | "promoted" | "validation_failed" | "disabled" | "host_selected" | "environment_imported";
};

export class UnknownInstanceCredentialError extends Error {
  readonly code = "UNKNOWN_INSTANCE_CREDENTIAL";
  readonly status = 404;

  constructor() {
    super("Credential key is not supported");
  }
}

export class HostCredentialUnavailableError extends Error {
  readonly code = "HOST_CREDENTIAL_UNAVAILABLE";
  readonly status = 409;

  constructor() {
    super("No approved host-managed value is configured");
  }
}

function requireKey(key: string): InstanceCredentialKey {
  if (!getInstanceCredentialDefinition(key)) throw new UnknownInstanceCredentialError();
  return key as InstanceCredentialKey;
}

function environmentValue(
  key: InstanceCredentialKey,
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string | null {
  const definition = getInstanceCredentialDefinition(key)!;
  for (const alias of definition.envAliases) {
    const value = environment[alias];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function safeErrorCode(value: string | null): string | null {
  return value && /^[A-Z0-9_]{1,64}$/.test(value) ? value : null;
}

export function createInstanceCredentialService({
  store = instanceCredentialStore,
  environment = process.env,
  encryption = createEncryption(),
  rootKeyHealthResolver,
}: {
  store?: InstanceCredentialStore;
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  encryption?: ReturnType<typeof createEncryption>;
  rootKeyHealthResolver?: () => Promise<RootKeyHealthMetadata>;
} = {}) {
  const listeners = new Set<(event: InstanceCredentialChangeEvent) => void>();

  function publish(event: InstanceCredentialChangeEvent): void {
    for (const listener of listeners) listener(event);
  }

  function subscribe(listener: (event: InstanceCredentialChangeEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function resolve(inputKey: string): Promise<ResolvedInstanceCredential> {
    const key = requireKey(inputKey);
    const record = await store.get(key);
    if (record?.activeValueEncrypted) {
      return { key, source: "stored", value: encryption.decrypt(record.activeValueEncrypted) };
    }
    if (record?.disabled) return { key, source: "disabled", value: null };
    const fallback = environmentValue(key, environment);
    if (fallback !== null) return { key, source: "environment", value: fallback };
    return { key, source: "absent", value: null };
  }

  async function readPending(inputKey: string): Promise<{ value: string; version: number } | null> {
    const key = requireKey(inputKey);
    const record = await store.get(key);
    if (!record?.pendingValueEncrypted) return null;
    return { value: encryption.decrypt(record.pendingValueEncrypted), version: record.version };
  }

  function metadataFor(
    key: InstanceCredentialKey,
    record: InstanceCredentialRecord | null,
  ): InstanceCredentialMetadata {
    const definition = getInstanceCredentialDefinition(key)!;
    const hasEnvironment = environmentValue(key, environment) !== null;
    let source: InstanceCredentialSource = "absent";
    if (record?.activeValueEncrypted) source = "stored";
    else if (record?.disabled) source = "disabled";
    else if (hasEnvironment) source = "environment";
    return {
      key,
      handling: definition.handling,
      capabilities: [...definition.capabilities],
      source,
      activeConfigured: Boolean(record?.activeValueEncrypted) || source === "environment",
      pendingConfigured: Boolean(record?.pendingValueEncrypted),
      validationState: record?.validationState ?? "untested",
      lastTestedAt: record?.lastTestedAt ?? null,
      lastSucceededAt: record?.lastSucceededAt ?? null,
      lastFailedAt: record?.lastFailedAt ?? null,
      errorCode: safeErrorCode(record?.errorCode ?? null),
      version: record?.version ?? null,
    };
  }

  async function rootKeyMetadata(records: InstanceCredentialRecord[]): Promise<RootKeyHealthMetadata> {
    const health = getRootKeyHealth(environment.EA_ENCRYPTION_KEY);
    if (!health.valid) return { ...health, decryptability: "unavailable" };
    try {
      for (const record of records) {
        if (record.activeValueEncrypted) encryption.decrypt(record.activeValueEncrypted);
        if (record.pendingValueEncrypted) encryption.decrypt(record.pendingValueEncrypted);
      }
      return { ...health, decryptability: "ok" };
    } catch {
      return { ...health, decryptability: "failed" };
    }
  }

  async function getMetadata(): Promise<InstanceCredentialMetadataResponse> {
    const records = await store.list();
    const byKey = new Map(records.map((record) => [record.key, record]));
    return {
      credentials: listInstanceCredentialDefinitions().map((definition) =>
        metadataFor(definition.key as InstanceCredentialKey, byKey.get(definition.key as InstanceCredentialKey) ?? null),
      ),
      rootKey: rootKeyHealthResolver
        ? await rootKeyHealthResolver()
        : await rootKeyMetadata(records),
    };
  }

  async function getCredentialMetadata(inputKey: string): Promise<InstanceCredentialMetadata> {
    const key = requireKey(inputKey);
    return metadataFor(key, await store.get(key));
  }

  async function stagePending(inputKey: string, value: string): Promise<InstanceCredentialMetadata> {
    const key = requireKey(inputKey);
    const record = await store.stagePending(key, encryption.encrypt(value));
    publish({ key, reason: "pending_staged" });
    return metadataFor(key, record);
  }

  async function promotePending(inputKey: string, expectedVersion: number): Promise<InstanceCredentialMetadata> {
    const key = requireKey(inputKey);
    const record = await store.promotePending(key, expectedVersion);
    publish({ key, reason: "promoted" });
    return metadataFor(key, record);
  }

  async function recordPendingFailure(inputKey: string, expectedVersion: number, errorCode: string): Promise<InstanceCredentialMetadata> {
    const key = requireKey(inputKey);
    const redactedCode = safeErrorCode(errorCode) ?? "VALIDATION_FAILED";
    const record = await store.recordPendingFailure(key, expectedVersion, redactedCode);
    publish({ key, reason: "validation_failed" });
    return metadataFor(key, record);
  }

  async function disable(inputKey: string): Promise<InstanceCredentialMetadata> {
    const key = requireKey(inputKey);
    const record = await store.disable(key);
    publish({ key, reason: "disabled" });
    return metadataFor(key, record);
  }

  async function useHostValue(inputKey: string): Promise<InstanceCredentialMetadata> {
    const key = requireKey(inputKey);
    await store.useHostValue(key);
    publish({ key, reason: "host_selected" });
    return metadataFor(key, null);
  }

  async function importEnvironment(inputKey: string): Promise<InstanceCredentialMetadata> {
    const key = requireKey(inputKey);
    const value = environmentValue(key, environment);
    if (value === null) throw new HostCredentialUnavailableError();
    const record = await store.importActive(key, encryption.encrypt(value));
    publish({ key, reason: "environment_imported" });
    return metadataFor(key, record);
  }

  return {
    resolve,
    readPending,
    getMetadata,
    getCredentialMetadata,
    stagePending,
    promotePending,
    recordPendingFailure,
    disable,
    useHostValue,
    importEnvironment,
    subscribe,
  };
}

export type InstanceCredentialService = ReturnType<typeof createInstanceCredentialService>;
export const instanceCredentialService = createInstanceCredentialService({
  rootKeyHealthResolver: () => rootKeyHealthService.getMetadata(),
});
