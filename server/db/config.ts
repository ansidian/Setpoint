import type { Config } from "@libsql/client";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const LOCAL_DB_URL = "file:server/db/ea.db";

type DatabaseEnvironment = Record<string, string | undefined>;

export type DatabaseClientConfig = {
  mode: "local" | "production";
  client: Config;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

export function resolveDatabaseClientConfig(
  env: DatabaseEnvironment = process.env,
): DatabaseClientConfig {
  const nodeEnv = env.NODE_ENV || "development";
  // Deployment files still pin EA_DB_ADAPTER=sqlite; reject anything else so a stale
  // remote-database environment fails loudly instead of silently opening a local file.
  const adapter = clean(env.EA_DB_ADAPTER).toLowerCase();
  if (adapter && adapter !== "sqlite") {
    throw new Error("[EA] EA_DB_ADAPTER must be sqlite (local SQLite is the only supported database)");
  }

  const localPath = clean(env.EA_SQLITE_PATH);
  if (nodeEnv === "production" && (!isAbsolute(localPath) || localPath.includes(":memory:"))) {
    throw new Error("[EA] Production requires EA_SQLITE_PATH to be an absolute persistent file path");
  }
  if (localPath && (!isAbsolute(localPath) || localPath.includes(":memory:"))) {
    throw new Error("[EA] EA_SQLITE_PATH must be an absolute persistent file path");
  }
  return {
    mode: nodeEnv === "production" ? "production" : "local",
    client: { url: localPath ? pathToFileURL(localPath).href : LOCAL_DB_URL },
  };
}
