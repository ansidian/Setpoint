import type { Config } from "@libsql/client";

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

export function parseBooleanEnv(value: unknown) {
  return ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());
}

export function resolveDatabaseClientConfig(
  env: DatabaseEnvironment = process.env,
): DatabaseClientConfig {
  const nodeEnv = env.NODE_ENV || "development";
  const explicitDevTurso = clean(env.EA_DEV_DB_ADAPTER).toLowerCase() === "turso"
    || clean(env.AI_SEARCH_VECTOR_ADAPTER).toLowerCase() === "turso";
  const useTurso = nodeEnv === "production" || explicitDevTurso;

  if (!useTurso) {
    return {
      mode: "local",
      adapter: "sqlite",
      client: { url: LOCAL_DB_URL },
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
