const BASE_REQUIRED_ENV = ["EA_ENCRYPTION_KEY"];
const PRODUCTION_REQUIRED_ENV = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
];

export function getMissingRequiredEnv(env = process.env) {
  const required = env.NODE_ENV === "production" && env.EA_DB_ADAPTER?.trim().toLowerCase() !== "sqlite"
    ? [...BASE_REQUIRED_ENV, ...PRODUCTION_REQUIRED_ENV]
    : BASE_REQUIRED_ENV;
  return required.filter((key) => !env[key]);
}

export function backgroundWorkersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.EA_BACKGROUND_WORKERS_ENABLED?.trim();
  if (!value || value === "1") return true;
  if (value === "0") return false;
  throw new Error("[EA] EA_BACKGROUND_WORKERS_ENABLED must be 0 or 1");
}
