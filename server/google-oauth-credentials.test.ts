import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestTempDir, removeTempDir } from "./test-utils/temp-dir.ts";
import { createEncryption } from "./platform/encryption.ts";
import { createInstanceCredentialService } from "./platform/instance-credential-service.ts";
import { createInstanceCredentialStore } from "./platform/instance-credential-store.ts";
import { createGoogleOAuthCredentialManager } from "./google-oauth-credentials.ts";

const ROOT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const migrationSql = readFileSync(
  path.join(process.cwd(), "server/db/migrations/033_instance_credentials.sql"),
  "utf8",
);

describe("Google OAuth credential manager", () => {
  let db: Client;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTestTempDir("google-oauth-");
    db = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
    await db.executeMultiple(migrationSql);
  });

  afterEach(async () => {
    db.close();
    await removeTempDir(tempDir);
  });

  function manager(environment: Record<string, string | undefined> = {}) {
    const service = createInstanceCredentialService({
      store: createInstanceCredentialStore(db),
      environment: { EA_ENCRYPTION_KEY: ROOT_KEY, ...environment },
      encryption: createEncryption(() => ROOT_KEY),
    });
    return { service, manager: createGoogleOAuthCredentialManager(service) };
  }

  it("uses the legacy environment pair until a candidate is validated", async () => {
    const { manager: google, service } = manager({
      GOOGLE_CLIENT_ID: "env-client-id",
      GOOGLE_CLIENT_SECRET: "env-client-secret",
    });

    expect(await google.selectForAuthorization()).toEqual({
      credentials: { clientId: "env-client-id", clientSecret: "env-client-secret" },
      candidateVersions: null,
    });

    const staged = await google.stageCandidate({
      clientId: "candidate-client-id",
      clientSecret: "candidate-client-secret",
    });
    const selection = await google.selectForAuthorization();
    expect(selection.credentials).toEqual({
      clientId: "candidate-client-id",
      clientSecret: "candidate-client-secret",
    });
    expect(selection.candidateVersions).toEqual(staged.candidateVersions);
    expect(await google.resolveCandidate(staged.candidateVersions)).toEqual(selection.credentials);
    expect((await service.resolve("google.oauth_client_id")).value).toBe("env-client-id");

    await google.promoteCandidate(selection.candidateVersions!);
    expect(await google.resolveActive()).toEqual({
      clientId: "candidate-client-id",
      clientSecret: "candidate-client-secret",
    });
  });

  it("rejects incomplete and stale candidates without replacing active credentials", async () => {
    const { manager: google, service } = manager({
      GOOGLE_CLIENT_ID: "env-client-id",
      GOOGLE_CLIENT_SECRET: "env-client-secret",
    });
    await service.stagePending("google.oauth_client_id", "partial-client-id");
    await expect(google.selectForAuthorization()).rejects.toMatchObject({
      code: "GOOGLE_OAUTH_CANDIDATE_INCOMPLETE",
    });

    const first = await google.stageCandidate({ clientId: "first-id", clientSecret: "first-secret" });
    await google.stageCandidate({ clientId: "second-id", clientSecret: "second-secret" });
    await expect(google.resolveCandidate(first.candidateVersions)).rejects.toMatchObject({
      code: "INSTANCE_CREDENTIAL_CONFLICT",
    });
    await expect(google.promoteCandidate(first.candidateVersions)).rejects.toMatchObject({
      code: "INSTANCE_CREDENTIAL_CONFLICT",
    });
    expect(await google.resolveActive()).toEqual({
      clientId: "env-client-id",
      clientSecret: "env-client-secret",
    });
  });
});
