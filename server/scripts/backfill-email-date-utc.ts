import "dotenv/config";
import db from "../db/connection.ts";
import { normalizeEmailDateUtc } from "../email/email-date.ts";
import type { InStatement, Row } from "@libsql/client";

const BATCH_SIZE = 250;

async function loadRows(offset: number): Promise<Row[]> {
  const result = await db.execute({
    sql: `SELECT uid, email_date, email_date_utc
          FROM ea_email_index
          ORDER BY uid
          LIMIT ? OFFSET ?`,
    args: [BATCH_SIZE, offset],
  });
  return result.rows;
}

async function backfillEmailDateUtc() {
  let offset = 0;
  let scanned = 0;
  let updated = 0;
  let unparseable = 0;

  while (true) {
    const rows = await loadRows(offset);
    if (!rows.length) break;
    scanned += rows.length;
    offset += rows.length;

    const statements: InStatement[] = [];
    for (const row of rows) {
      const normalized = normalizeEmailDateUtc(row.email_date);
      if (!normalized) {
        unparseable += 1;
        continue;
      }
      if (row.uid === undefined) continue;
      if (row.email_date_utc === normalized) continue;
      statements.push({
        sql: "UPDATE ea_email_index SET email_date_utc = ? WHERE uid = ?",
        args: [normalized, row.uid],
      });
    }
    if (statements.length) {
      await db.batch(statements);
      updated += statements.length;
    }
  }

  return { scanned, updated, unparseable };
}

backfillEmailDateUtc()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    return db.close?.();
  })
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await db.close?.();
    process.exit(1);
  });
