import { chunkArray } from "./gmail.ts";
import { providerStateFromMetadata } from "./gmailHistoryProjection.ts";
import { markProviderRemovedFromActiveSnapshots } from "../snapshots/snapshot-service.ts";
import type { InStatement } from "@libsql/client";
import type { EmailWriteDb } from "./email-persistence-types.ts";
import type {
  GmailMessageMetadata,
  GmailProviderRemovalEvent,
  GmailSyncAccount,
} from "./email-sync-types.ts";
import { syncErrorMessage } from "./email-sync-types.ts";

interface GmailIndexIdentityRow extends Record<string, unknown> {
  uid: string;
  account_id: string;
  account_email?: string;
}

// Gmail row reconciliation lifted from gmail-sync.ts: resolve the mailbox's
// indexed account_ids, find existing rows for a set of message ids, then
// reconcile read state and provider-removal state against ea_email_index +
// active snapshots. The row-resolution pair stays module-private (NEST not
// sibling): both reconcilers depend on it, splitting it out would force a
// circular import. IO is injected (dbClient + fetch fns + now).

// SQLite caps bound parameters per statement; chunk uid IN lists to stay well
// under it (mirrors EMAIL_INDEX_LOOKUP_CHUNK_SIZE in email-index.ts).
const GMAIL_ROW_LOOKUP_CHUNK_SIZE = 500;
// Bound the parallel per-message metadata fetches during reconciliation (mirrors
// the chunk size fetchMessages uses) so a large label-change burst does not open
// hundreds of simultaneous Gmail requests.
const GMAIL_METADATA_FETCH_CHUNK_SIZE = 15;

// Resolve every account_id that holds indexed rows for this Gmail mailbox: the
// synced account plus any sibling ids carrying the same canonical email under a
// stale account_id (re-OAuth / canonical drift). One DISTINCT lookup returns a
// tiny id set instead of the wide all-rows scan the caller used to materialize.
async function resolveGmailMailboxAccountIds(account: GmailSyncAccount, dbClient: EmailWriteDb): Promise<string[]> {
  const ids = new Set<string>();
  for (const id of [account.id, account.uid_account_id, account.canonical_id]) {
    if (id) ids.add(id);
  }
  const email = account.email || "";
  if (email) {
    const result = await dbClient.execute({
      sql: `SELECT DISTINCT account_id
            FROM ea_email_index
            WHERE user_id = ?
              AND uid LIKE 'gmail-%'
              AND lower(account_email) = lower(?)`,
      args: [account.user_id, email],
    });
    for (const row of result.rows) {
      if (row.account_id) ids.add(String(row.account_id));
    }
  }
  return [...ids];
}

async function findExistingGmailRowsForMessageIds(account: GmailSyncAccount, messageIds: string[], dbClient: EmailWriteDb): Promise<Map<string, GmailIndexIdentityRow[]>> {
  const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean);
  if (!uniqueMessageIds.length) return new Map();

  // P1-5: query the uid PRIMARY KEY with chunked IN lists for exactly the
  // candidate uids (gmail-<accountId>-<messageId>) instead of scanning the whole
  // gmail slice of ea_email_index and filtering messageIds in JS. Candidate uids
  // are built from (accountId, messageId) pairs and mapped back to their
  // messageId, which is robust to account_ids that themselves contain dashes.
  const accountIds = await resolveGmailMailboxAccountIds(account, dbClient);
  if (!accountIds.length) return new Map();

  const uidToMessageId = new Map<string, string>();
  for (const accountId of accountIds) {
    for (const messageId of uniqueMessageIds) {
      uidToMessageId.set(`gmail-${accountId}-${messageId}`, messageId);
    }
  }
  const candidateUids = [...uidToMessageId.keys()];

  const rowsByMessageId = new Map<string, GmailIndexIdentityRow[]>();
  for (let i = 0; i < candidateUids.length; i += GMAIL_ROW_LOOKUP_CHUNK_SIZE) {
    const chunk = candidateUids.slice(i, i + GMAIL_ROW_LOOKUP_CHUNK_SIZE);
    const result = await dbClient.execute({
      sql: `SELECT uid, account_id, account_email
            FROM ea_email_index
            WHERE user_id = ?
              AND uid IN (${chunk.map(() => "?").join(",")})`,
      args: [account.user_id, ...chunk],
    });
    for (const row of result.rows as GmailIndexIdentityRow[]) {
      const messageId = uidToMessageId.get(row.uid);
      if (!messageId) continue;
      const bucket = rowsByMessageId.get(messageId);
      if (bucket) bucket.push(row);
      else rowsByMessageId.set(messageId, [row]);
    }
  }
  return rowsByMessageId;
}

export async function reconcileReadStateForExistingMessages(account: GmailSyncAccount, messageIds: string[], {
  dbClient,
  fetchMessageReadStateFn,
}: {
  dbClient: EmailWriteDb;
  fetchMessageReadStateFn: (account: GmailSyncAccount, messageId: string) => Promise<boolean | null>;
}): Promise<number> {
  const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean);
  if (!uniqueMessageIds.length) return 0;

  const rowsByMessageId = await findExistingGmailRowsForMessageIds(account, uniqueMessageIds, dbClient);
  const pendingIds = uniqueMessageIds.filter((messageId) => (rowsByMessageId.get(messageId) || []).length);
  if (!pendingIds.length) return 0;

  // P2-13: fetch the authoritative per-message read state in bounded parallel
  // chunks instead of one serial GET per id; build the UPDATE statements from the
  // resolved results, then apply them in a single batch as before.
  const statements: InStatement[] = [];
  for (const chunk of chunkArray(pendingIds, GMAIL_METADATA_FETCH_CHUNK_SIZE)) {
    const results: Array<{ messageId: string; read?: boolean | null; error?: unknown }> = await Promise.all(chunk.map((messageId) =>
      Promise.resolve()
        .then(() => fetchMessageReadStateFn(account, messageId))
        .then((read) => ({ messageId, read }))
        .catch((error: unknown) => ({ messageId, read: undefined, error })),
    ));
    for (const { messageId, read, error } of results) {
      if (error) {
        console.warn(
          `[Gmail Sync] Failed to reconcile read state for ${account.email}/${messageId}: ${syncErrorMessage(error)}`,
        );
        continue;
      }
      if (read == null) {
        console.warn(`[Gmail Sync] Could not confirm read state for ${account.email}/${messageId}`);
        continue;
      }
      for (const row of rowsByMessageId.get(messageId) || []) {
        statements.push({
          sql: `UPDATE ea_email_index
                SET read = ?
                WHERE user_id = ?
                  AND account_id = ?
                  AND uid = ?`,
          args: [read ? 1 : 0, account.user_id, row.account_id, row.uid],
        });
      }
    }
  }
  if (statements.length) await dbClient.batch(statements);
  return statements.length;
}

export async function reconcileProviderRemovalForExistingMessages(account: GmailSyncAccount, removalEvents: Map<string, Set<GmailProviderRemovalEvent>>, {
  dbClient,
  fetchMessageMetadataFn,
  now = new Date(),
}: {
  dbClient: EmailWriteDb;
  fetchMessageMetadataFn: (account: GmailSyncAccount, messageId: string) => Promise<GmailMessageMetadata | null>;
  now?: Date;
}): Promise<number> {
  const messageIds = [...removalEvents.keys()];
  if (!messageIds.length) return 0;

  const rowsByMessageId = await findExistingGmailRowsForMessageIds(account, messageIds, dbClient);
  const pendingIds = messageIds.filter((messageId) => (rowsByMessageId.get(messageId) || []).length);
  if (!pendingIds.length) return 0;

  // P2-13: fetch each message's metadata in bounded parallel chunks; the snapshot
  // write-backs (markProviderRemovedFromActiveSnapshots) still run sequentially
  // after the fetch so ordering and the removed count are unchanged.
  let removed = 0;
  for (const chunk of chunkArray(pendingIds, GMAIL_METADATA_FETCH_CHUNK_SIZE)) {
    const results: Array<{ messageId: string; metadata?: GmailMessageMetadata | null; error?: unknown }> = await Promise.all(chunk.map((messageId) =>
      Promise.resolve()
        .then(() => fetchMessageMetadataFn(account, messageId))
        .then((metadata) => ({ messageId, metadata }))
        .catch((error: unknown) => ({ messageId, metadata: undefined, error })),
    ));
    for (const { messageId, metadata, error } of results) {
      if (error) {
        console.warn(
          `[Gmail Sync] Failed to reconcile provider removal for ${account.email}/${messageId}: ${syncErrorMessage(error)}`,
        );
        continue;
      }
      const eventTypes = removalEvents.get(messageId) || new Set();
      let providerState = providerStateFromMetadata(metadata);
      if (!providerState && eventTypes.has("message_deleted")) providerState = "trashed";
      if (!providerState && eventTypes.has("trash_added")) providerState = "trashed";
      if (!providerState && metadata == null && eventTypes.has("inbox_removed")) providerState = "archived";
      if (!providerState) {
        if (metadata == null) {
          console.warn(`[Gmail Sync] Could not confirm provider state for ${account.email}/${messageId}`);
        }
        continue;
      }
      for (const row of rowsByMessageId.get(messageId) || []) {
        await markProviderRemovedFromActiveSnapshots(
          account.user_id,
          row.account_id,
          row.uid,
          providerState,
          { dbClient, now },
        );
        removed++;
      }
    }
  }
  return removed;
}
