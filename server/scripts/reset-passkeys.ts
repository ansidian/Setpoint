import "dotenv/config";
import db from "../db/connection.ts";
import type { Client } from "@libsql/client";

export const PASSKEY_RESET_TABLES = [
  "ea_passkey_credentials",
  "ea_pending_auth",
  "ea_webauthn_challenges",
  "ea_sessions",
];

interface ResetOptions {
  confirm?: boolean;
  dryRun: boolean;
}

export function parseArgs(args: string[] = process.argv.slice(2)): Required<ResetOptions> {
  const confirm = args.includes("--confirm");
  const dryRun = args.includes("--dry-run") || !confirm;
  if (confirm && args.includes("--dry-run")) {
    throw new Error("Use either --confirm or --dry-run, not both.");
  }
  return { confirm, dryRun };
}

export async function runPasskeyReset(
  database: Pick<Client, "execute"> = db,
  options: ResetOptions = parseArgs(),
) {
  if (!options.dryRun && !options.confirm) {
    throw new Error("Passkey reset requires --confirm. Use --dry-run to inspect counts.");
  }

  const counts: Record<string, number> = {};
  for (const table of PASSKEY_RESET_TABLES) {
    const result = await database.execute(`SELECT COUNT(*) AS count FROM ${table}`);
    counts[table] = Number(result.rows[0]?.count || 0);
  }

  if (options.dryRun) {
    return { dryRun: true, counts };
  }

  for (const table of PASSKEY_RESET_TABLES) {
    await database.execute(`DELETE FROM ${table}`);
  }

  return { dryRun: false, counts };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  runPasskeyReset()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
