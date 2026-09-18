import type { Config } from "@libsql/client";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const LOCAL_DB_URL = "file:server/db/ea.db";

type DatabaseEnvironment = Record<string, string | undefined>;

export type DatabaseClientConfig = {
  mode: "local" | "production" | "dev-turso";
  adapter: "sqlite" | "turso";
  client: Config;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

export function resolveDatabaseClientConfig(
  env: DatabaseEnvironment = process.env,
): DatabaseClientConfig {
  const nodeEnv = env.NODE_ENV || "development";
  const adapter = clean(env.EA_DB_ADAPTER).toLowerCase();
  if (adapter && adapter !== "sqlite" && adapter !== "turso") {
    throw new Error("[EA] EA_DB_ADAPTER must be sqlite or turso");
  }
  const explicitDevTurso = clean(env.EA_DEV_DB_ADAPTER).toLowerCase() === "turso"
    || clean(env.AI_SEARCH_VECTOR_ADAPTER).toLowerCase() === "turso";
  const useTurso = adapter ? adapter === "turso" : nodeEnv === "production" || explicitDevTurso;

  if (!useTurso) {
    const localPath = clean(env.EA_SQLITE_PATH);
    if (nodeEnv === "production" && (!isAbsolute(localPath) || localPath.includes(":memory:"))) {
      throw new Error("[EA] Local production requires EA_SQLITE_PATH to be an absolute persistent file path");
    }
    if (localPath && (!isAbsolute(localPath) || localPath.includes(":memory:"))) {
      throw new Error("[EA] EA_SQLITE_PATH must be an absolute persistent file path");
    }
    return {
      mode: nodeEnv === "production" ? "production" : "local",
      adapter: "sqlite",
      client: { url: localPath ? pathToFileURL(localPath).href : LOCAL_DB_URL },
    };
  }

  const missing = [];
  if (!clean(env.TURSO_DATABASE_URL)) missing.push("TURSO_DATABASE_URL");
  if (!clean(env.TURSO_AUTH_TOKEN)) missing.push("TURSO_AUTH_TOKEN");
  if (missing.length) {
    const context = nodeEnv === "production"
      ? "production database"
      : "opt-in Turso AI search dev mode";
    throw new Error(`[EA] Missing required env vars for ${context}: ${missing.join(", ")}`);
  }

  return {
    mode: nodeEnv === "production" ? "production" : "dev-turso",
    adapter: "turso",
    client: {
      url: clean(env.TURSO_DATABASE_URL),
      authToken: clean(env.TURSO_AUTH_TOKEN),
    },
  };
}
