import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALFRED_MODEL, loadAlfredModelConfig,
  resolveAlfredModelConfig
} from "./alfred-models.ts";

describe("Alfred model configuration", () => {
  it("returns the Anthropic default when storage is empty", () => {
    expect(resolveAlfredModelConfig()).toEqual({ provider: "anthropic", model: DEFAULT_ALFRED_MODEL });
  });

  it("falls back to the selected provider's default when its stored model is invalid", () => {
    expect(resolveAlfredModelConfig({ provider: "openai", model: "claude-sonnet-4-6" }))
      .toEqual({ provider: "openai", model: "gpt-5.6-sol" });
  });

  it("loads and normalizes the persisted pair", async () => {
    const db = createClient({ url: "file::memory:" });
    try {
      await db.executeMultiple(readFileSync(
        new URL("../db/migrations/001_ea_tables.sql", import.meta.url),
        "utf8",
      ));
      await db.executeMultiple(readFileSync(
        new URL("../db/migrations/044_alfred_model_settings.sql", import.meta.url),
        "utf8",
      ));
      await db.execute({
        sql: `INSERT INTO ea_settings (user_id, alfred_provider, alfred_model)
              VALUES ('user-1', 'openai', 'gpt-5.6-sol')`,
      });

      await expect(loadAlfredModelConfig("user-1", db))
        .resolves.toEqual({ provider: "openai", model: "gpt-5.6-sol" });
    } finally {
      await db.close();
    }
  });
});
