// Production's EA_SQLITE_PATH requirement is enforced by db/config.ts.
const REQUIRED_ENV = ["EA_ENCRYPTION_KEY"];

export function getMissingRequiredEnv(env = process.env) {
  return REQUIRED_ENV.filter((key) => !env[key]);
}

export function backgroundWorkersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.EA_BACKGROUND_WORKERS_ENABLED?.trim();
  if (!value || value === "1") return true;
  if (value === "0") return false;
  throw new Error("[EA] EA_BACKGROUND_WORKERS_ENABLED must be 0 or 1");
}
