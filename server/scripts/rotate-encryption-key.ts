import db from "../db/connection.ts";
import { pathToFileURL } from "node:url";
import { rotateRootEncryptionKey } from "../platform/root-key-rotation.ts";

function usage(): string {
  return [
    "Usage:",
    "  npm run security:rotate-encryption-key",
    "  npm run security:rotate-encryption-key -- --apply --confirm-offline",
    "",
    "EA_ENCRYPTION_KEY and EA_ENCRYPTION_KEY_NEXT must be set in the command environment.",
    "Dry-run is the default. Stop every Setpoint process before using --apply.",
  ].join("\n");
}

export function parseRootKeyRotationArgs(args: string[]): { apply: boolean } {
  const unknown = args.filter((arg) => arg !== "--apply" && arg !== "--confirm-offline");
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
  const apply = args.includes("--apply");
  if (apply && !args.includes("--confirm-offline")) {
    throw new Error("--apply requires --confirm-offline after every Setpoint process is stopped");
  }
  if (!apply && args.includes("--confirm-offline")) {
    throw new Error("--confirm-offline is only valid with --apply");
  }
  return { apply };
}

async function main(): Promise<void> {
  try {
    const { apply } = parseRootKeyRotationArgs(process.argv.slice(2));
    const oldKey = process.env.EA_ENCRYPTION_KEY;
    const newKey = process.env.EA_ENCRYPTION_KEY_NEXT;
    if (!oldKey || !newKey) {
      throw new Error("EA_ENCRYPTION_KEY and EA_ENCRYPTION_KEY_NEXT are required");
    }
    const result = await rotateRootEncryptionKey({
      dbClient: db,
      oldKey,
      newKey,
      apply,
    });
    console.log(JSON.stringify({
      mode: result.applied ? "applied" : "dry-run",
      credentialCount: result.credentialCount,
      targetCounts: result.targetCounts,
      oldKeyFingerprint: result.oldKeyFingerprint,
      newKeyFingerprint: result.newKeyFingerprint,
    }, null, 2));
    if (!result.applied) {
      console.log("Dry-run complete. No credential rows were changed.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Root key rotation failed");
    console.error(usage());
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
