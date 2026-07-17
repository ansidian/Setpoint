import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createAuthTestDb, seedOwner } from "../test-utils/auth-db.ts";
import {
  createRecoveryCodeStore,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "./recovery-code-store.ts";

describe("recovery codes", () => {
  let db: Client;

  beforeEach(async () => {
    db = await createAuthTestDb();
    await seedOwner(db, { passwordHash: "bcrypt-hash" });
  });

  afterEach(() => db.close());

  it("generates unique high-entropy codes and stores only their hashes", async () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes.every((code) => /^SP(?:-[A-F0-9]{4}){8}$/.test(code))).toBe(true);

    const store = createRecoveryCodeStore(db);
    await store.replaceRecoveryCodes("user-1", codes, 100);
    const result = await db.execute("SELECT code_hash FROM ea_owner_recovery_codes");
    expect(result.rows.map((row) => row.code_hash)).toContain(hashRecoveryCode(codes[0]));
    expect(JSON.stringify(result.rows)).not.toContain(codes[0]);
  });

  it("allows exactly one concurrent consumption and rejects replay", async () => {
    const code = generateRecoveryCodes()[0]!;
    const store = createRecoveryCodeStore(db);
    await store.replaceRecoveryCodes("user-1", [code], 100);

    const results = await Promise.all([
      store.consumeRecoveryCode("user-1", code, 200),
      store.consumeRecoveryCode("user-1", code, 201),
    ]);
    expect(results.sort()).toEqual([false, true]);
    await expect(store.consumeRecoveryCode("user-1", code, 202)).resolves.toBe(false);
    await expect(store.getRecoveryCodeStatus("user-1")).resolves.toEqual({
      remaining: 0,
      generatedAt: 100,
    });
  });
});
