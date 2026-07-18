import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOnboardingProgressStore } from "./onboarding-progress-store.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("onboarding progress store", () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: "file::memory:" });
    for (const migration of ["001_ea_tables.sql", "030_owner_bootstrap.sql", "037_onboarding_progress.sql"]) {
      await db.executeMultiple(readFileSync(join(__dirname, `db/migrations/${migration}`), "utf8"));
    }
    await db.execute({
      sql: "INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at) VALUES (1, ?, 'hash', ?)",
      args: ["new-owner", Date.now()],
    });
  });

  afterEach(() => db.close());

  it("defaults a newly claimed owner to pending progress and persists step state", async () => {
    const store = createOnboardingProgressStore(db, () => 100);

    await expect(store.get("new-owner")).resolves.toMatchObject({ status: "in_progress", steps: {} });
    await expect(store.update("new-owner", { action: "skip", stepId: "ai" })).resolves.toMatchObject({
      status: "in_progress",
      steps: { ai: "skipped" },
      updatedAt: 100,
    });
    await expect(store.update("new-owner", { action: "complete", stepId: "tasks" })).resolves.toMatchObject({
      steps: { ai: "skipped", tasks: "completed" },
    });
  });

  it("finishes without requiring integrations and can be explicitly reopened", async () => {
    let now = 200;
    const store = createOnboardingProgressStore(db, () => now);

    await expect(store.update("new-owner", { action: "finish" })).resolves.toMatchObject({
      status: "complete",
      completedAt: 200,
    });
    now = 300;
    await expect(store.update("new-owner", { action: "reopen" })).resolves.toMatchObject({
      status: "in_progress",
      completedAt: null,
      updatedAt: 300,
    });
  });

  it("backfills an owner present during migration as already finished", async () => {
    const legacyDb = createClient({ url: "file::memory:" });
    try {
      for (const migration of ["001_ea_tables.sql", "030_owner_bootstrap.sql"]) {
        await legacyDb.executeMultiple(readFileSync(join(__dirname, `db/migrations/${migration}`), "utf8"));
      }
      await legacyDb.execute("INSERT INTO ea_owner (singleton_id, user_id, password_hash, claimed_at) VALUES (1, 'legacy', 'hash', 1)");
      await legacyDb.executeMultiple(readFileSync(join(__dirname, "db/migrations/037_onboarding_progress.sql"), "utf8"));

      await expect(createOnboardingProgressStore(legacyDb).get("legacy")).resolves.toMatchObject({ status: "complete" });
    } finally {
      legacyDb.close();
    }
  });
});
