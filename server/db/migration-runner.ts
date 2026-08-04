import type { Client } from "@libsql/client";

type MigrationOptions = { dbClient: Client };

export async function runMigration(
  name: string,
  sql: string,
  { dbClient }: MigrationOptions,
): Promise<void> {
  console.log(`Running migration: ${name}`);
  // Apply the migration body and its ledger row as one atomic write transaction.
  // Transaction-level executeMultiple delegates statement splitting to libsql,
  // preserving comments, string literals, and trigger bodies.
  const tx = await dbClient.transaction("write");
  try {
    await tx.executeMultiple(sql);
    await tx.execute({
      sql: "INSERT INTO migrations (name) VALUES (?)",
      args: [name],
    });
    await tx.commit();
  } catch (error: unknown) {
    await tx.rollback().catch(() => {});
    throw error;
  }
  console.log(`Completed migration: ${name}`);
}
