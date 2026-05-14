const BASE_REQUIRED_ENV = ["EA_USER_ID", "EA_PASSWORD_HASH", "EA_ENCRYPTION_KEY"];
const PRODUCTION_REQUIRED_ENV = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "EA_WEBAUTHN_RP_NAME",
  "EA_WEBAUTHN_RP_ID",
  "EA_WEBAUTHN_ORIGIN",
];

export function getMissingRequiredEnv(env = process.env) {
  const required = env.NODE_ENV === "production"
    ? [...BASE_REQUIRED_ENV, ...PRODUCTION_REQUIRED_ENV]
    : BASE_REQUIRED_ENV;
  return required.filter((key) => !env[key]);
}
