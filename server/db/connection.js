import { createClient } from "@libsql/client";
import { getMissingRequiredEnv } from "../env.js";

const isProd = process.env.NODE_ENV === "production";

if (isProd) {
  const missing = getMissingRequiredEnv();
  if (missing.length) {
    throw new Error(`[EA] Missing required env vars: ${missing.join(", ")}`);
  }
}

const db = createClient(
  isProd
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: "file:server/db/ea.db" },
);

export default db;
