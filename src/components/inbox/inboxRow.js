// Canonical inbox EmailRow normalization (D-INBOX-2, EAD-330). Every inbox
// row — active-snapshot item, live-polled email, resurfaced snooze — is shaped
// here so field fallbacks (`uid` vs `email_id`, `from` vs `from_name`,
// `preview` vs `summary` vs `body_preview`) and the session read-override
// merge live in exactly one place. The collect* adapters in inboxWorkItems.js
// decide what to feed in per source; they no longer shape rows themselves.

export function readOverrideForUid(readOverrides, uid) {
  if (!uid || !readOverrides) return null;
  if (readOverrides instanceof Map) {
    return readOverrides.has(uid) ? readOverrides.get(uid) : null;
  }
  return Object.prototype.hasOwnProperty.call(readOverrides, uid)
    ? readOverrides[uid]
    : null;
}

export function mergeReadState(read, uid, readOverrides) {
  const override = readOverrideForUid(readOverrides, uid);
  return override == null ? !!read : !!override;
}

// Layer several override sources (Maps or plain objects) into one plain-object
// lookup consumable by readOverrideForUid/mergeReadState. Later sources win, so
// pass session-wide overrides first and the most local toggles last. A null
// override entry is treated as "no opinion" and does not shadow earlier layers.
export function composeReadOverrides(...sources) {
  const merged = {};
  for (const source of sources) {
    if (!source) continue;
    const entries = source instanceof Map ? source.entries() : Object.entries(source);
    for (const [uid, value] of entries) {
      if (!uid || value == null) continue;
      merged[uid] = !!value;
    }
  }
  return merged;
}

export function buildInboxRow(raw, {
  uid,
  id = raw.id || uid,
  account,
  read = raw.read,
  readOverrides = null,
  forceRead = false,
  lane = raw.lane ?? null,
  displayLane = null,
  live = false,
  activeSnapshot = false,
  untriaged = false,
  resurfaced = false,
  resurfacedAt = null,
  extras = null,
}) {
  return {
    ...raw,
    id,
    uid,
    subject: raw.subject || "",
    from: raw.from || raw.from_name || raw.from_address || "Unknown",
    fromEmail: raw.fromEmail || raw.from_email || raw.from_address || "",
    from_email: raw.from_email || raw.fromEmail || raw.from_address || "",
    preview: raw.preview || raw.summary || raw.body_preview || "",
    body_preview: raw.body_preview || raw.preview || raw.summary || "",
    date: raw.date || raw.email_date,
    read: forceRead ? true : mergeReadState(read, uid, readOverrides),
    _accountKey: account.id || account.name,
    _account: account,
    lane,
    _lane: displayLane,
    _untriaged: untriaged,
    _live: live,
    _activeSnapshot: activeSnapshot,
    _resurfaced: resurfaced,
    _resurfacedAt: resurfacedAt,
    ...(extras || null),
  };
}
