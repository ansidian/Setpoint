import db from "../db/connection.js";

/**
 * Check if an error message or response body contains 'invalid_grant' (case-insensitive).
 * This is narrower than classifyFailure's transient regex, targeting specifically
 * the OAuth token grant revocation pattern.
 * @param {string|null|undefined} errOrText - error message or response body text
 * @returns {boolean} true if the text contains 'invalid_grant'
 */
export function isInvalidGrantError(errOrText) {
  if (!errOrText) return false;
  const text = String(errOrText);
  return /invalid_grant/i.test(text);
}

/**
 * Mark an account as needing reauth due to token revocation.
 * WHERE-guarded to prevent unnecessary updates if already flagged.
 * @param {string} accountId - the account.id
 * @param {Object} options - { dbClient = db }
 * @returns {Promise<Object>} result with rowsAffected
 */
export async function markAccountNeedsReauth(accountId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: `UPDATE ea_accounts
          SET needs_reauth = 1, updated_at = datetime('now')
          WHERE id = ? AND needs_reauth = 0`,
    args: [accountId],
  });
  return result;
}

/**
 * Clear the reauth flag on an account.
 * WHERE-guarded to prevent unnecessary updates if already cleared.
 * @param {string} accountId - the account.id
 * @param {Object} options - { dbClient = db }
 * @returns {Promise<Object>} result with rowsAffected
 */
export async function clearAccountNeedsReauth(accountId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: `UPDATE ea_accounts
          SET needs_reauth = 0, updated_at = datetime('now')
          WHERE id = ? AND needs_reauth = 1`,
    args: [accountId],
  });
  return result;
}

/**
 * Mark Todoist as needing reauth due to token revocation.
 * WHERE-guarded to prevent unnecessary updates if already flagged.
 * @param {string} userId - the user.id
 * @param {Object} options - { dbClient = db }
 * @returns {Promise<Object>} result with rowsAffected
 */
export async function markTodoistNeedsReauth(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: `UPDATE ea_settings
          SET todoist_needs_reauth = 1
          WHERE user_id = ? AND todoist_needs_reauth = 0`,
    args: [userId],
  });
  return result;
}

/**
 * Clear the reauth flag on Todoist.
 * WHERE-guarded to prevent unnecessary updates if already cleared.
 * @param {string} userId - the user.id
 * @param {Object} options - { dbClient = db }
 * @returns {Promise<Object>} result with rowsAffected
 */
export async function clearTodoistNeedsReauth(userId, { dbClient = db } = {}) {
  const result = await dbClient.execute({
    sql: `UPDATE ea_settings
          SET todoist_needs_reauth = 0
          WHERE user_id = ? AND todoist_needs_reauth = 1`,
    args: [userId],
  });
  return result;
}
