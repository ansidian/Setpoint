const BASE_REQUIRED_ENV = ["EA_ENCRYPTION_KEY"];
const PRODUCTION_REQUIRED_ENV = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
];

export function getMissingRequiredEnv(env = process.env) {
  const required = env.NODE_ENV === "production"
    ? [...BASE_REQUIRED_ENV, ...PRODUCTION_REQUIRED_ENV]
    : BASE_REQUIRED_ENV;
  return required.filter((key) => !env[key]);
}
