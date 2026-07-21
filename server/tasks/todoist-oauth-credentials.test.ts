import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEncryption } from "../platform/encryption.ts";
import { createInstanceCredentialService } from "../platform/instance-credential-service.ts";
import { createInstanceCredentialStore } from "../platform/instance-credential-store.ts";
import { createTestTempDir, removeTempDir } from "../test-utils/temp-dir.ts";
import { createTodoistOAuthCredentialManager } from "./todoist-oauth-credentials.ts";

const ROOT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const migrationSql = ["033_instance_credentials.sql", "040_pending_credential_lifecycle.sql"]
  .map((file) => readFileSync(path.join(process.cwd(), "server/db/migrations", file), "utf8"))
  .join("\n");

describe("Todoist OAuth credential manager", () => {
  let db: Client;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTestTempDir("todoist-oauth-");
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
    return { service, manager: createTodoistOAuthCredentialManager(service) };
  }

  it("keeps the environment pair active until the matching candidate is promoted", async () => {
    const { manager: todoist, service } = manager({
      TODOIST_CLIENT_ID: "env-client-id",
      TODOIST_CLIENT_SECRET: "env-client-secret",
    });

    expect(await todoist.resolveActive()).toEqual({
      clientId: "env-client-id",
      clientSecret: "env-client-secret",
    });

    const staged = await todoist.stageCandidate({
      clientId: "candidate-client-id",
      clientSecret: "candidate-client-secret",
    });
    expect((await todoist.selectForAuthorization()).candidateVersions).toEqual(staged.candidateVersions);
    expect((await service.resolve("tasks.todoist_client_id")).value).toBe("env-client-id");

    await todoist.promoteCandidate(staged.candidateVersions);
    expect(await todoist.resolveActive()).toEqual({
      clientId: "candidate-client-id",
      clientSecret: "candidate-client-secret",
    });
  });

  it("rejects a stale candidate without replacing the working pair", async () => {
    const { manager: todoist } = manager({
      TODOIST_CLIENT_ID: "env-client-id",
      TODOIST_CLIENT_SECRET: "env-client-secret",
    });
    const first = await todoist.stageCandidate({ clientId: "first-id", clientSecret: "first-secret" });
    await todoist.stageCandidate({ clientId: "second-id", clientSecret: "second-secret" });

    await expect(todoist.resolveCandidate(first.candidateVersions)).rejects.toMatchObject({
      code: "INSTANCE_CREDENTIAL_CONFLICT",
    });
    expect(await todoist.resolveActive()).toEqual({
      clientId: "env-client-id",
      clientSecret: "env-client-secret",
    });
  });

  it("migrates the complete environment pair atomically without exposing it", async () => {
    const { manager: todoist, service } = manager({
      TODOIST_CLIENT_ID: "env-client-id",
      TODOIST_CLIENT_SECRET: "env-client-secret",
    });

    const metadata = await todoist.importEnvironment();

    expect(metadata.map((entry) => ({ key: entry.key, source: entry.source }))).toEqual([
      { key: "tasks.todoist_client_id", source: "stored" },
      { key: "tasks.todoist_client_secret", source: "stored" },
    ]);
    expect(await service.resolve("tasks.todoist_client_secret")).toMatchObject({
      source: "stored",
      value: "env-client-secret",
    });
  });

  it("discards the Todoist candidate pair at matching versions", async () => {
    const { manager: todoist } = manager({
      TODOIST_CLIENT_ID: "env-client-id",
      TODOIST_CLIENT_SECRET: "env-client-secret",
    });
    const staged = await todoist.stageCandidate({ clientId: "candidate-id", clientSecret: "candidate-secret" });

    await todoist.discardCandidate(staged.candidateVersions);

    await expect(todoist.selectForAuthorization()).resolves.toMatchObject({
      credentials: { clientId: "env-client-id", clientSecret: "env-client-secret" },
      candidateVersions: null,
    });
  });
});
