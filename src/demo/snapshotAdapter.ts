import type { PinnedEmailEntry } from "../../shared/types/email.ts";
import {
  NO_DEMO_API_RESPONSE,
  demoNotFound,
  demoPathSegment,
  type DemoApiRequest,
  type DemoLane,
} from "./apiHandler.ts";
import { allSnapshotRows, findSnapshotRow, mutateSnapshotRows } from "./snapshotRows.ts";
import type { DemoSeed } from "./store.ts";

type DemoSnapshot = DemoSeed["activeSnapshot"];
type DemoSnapshotRow = DemoSnapshot["carryover"][number];

const clone = <T>(value: T): T => value == null ? value : structuredClone(value);

function refreshLaneCounts(snapshot: DemoSnapshot): void {
  snapshot.laneCounts = {
    queued: snapshot.lanes.queued?.length || 0,
    needs_attention: snapshot.lanes.needs_attention?.length || 0,
    catch_up: snapshot.lanes.catch_up?.length || 0,
    fyi: snapshot.lanes.fyi?.length || 0,
    handled: snapshot.lanes.handled?.length || 0,
    untriaged_read: snapshot.lanes.untriaged_read?.length || 0,
    noise: snapshot.lanes.noise?.length || 0,
    carryover: snapshot.carryover?.length || 0,
  };
}

function findSnapshotRowLane(snapshot: DemoSnapshot, uid: string): DemoLane | "carryover" | null {
  for (const [lane, rows] of Object.entries(snapshot.lanes) as Array<[DemoLane, DemoSnapshotRow[]]>) {
    if (rows.some((row) => String(row.uid || row.email_id) === String(uid))) return lane;
  }
  if ((snapshot.carryover || []).some((row) => String(row.uid || row.email_id) === String(uid))) return "carryover";
  return null;
}

function removeSnapshotRow(snapshot: DemoSnapshot, uid: string): void {
  for (const [lane, rows] of Object.entries(snapshot.lanes) as Array<[DemoLane, DemoSnapshotRow[]]>) {
    snapshot.lanes[lane] = rows.filter((row) => String(row.uid || row.email_id) !== String(uid));
  }
  snapshot.carryover = (snapshot.carryover || []).filter((row) => String(row.uid || row.email_id) !== String(uid));
  refreshLaneCounts(snapshot);
}

function moveSnapshotRow(snapshot: DemoSnapshot, itemId: string, lane: DemoLane, preserveClassification = false): DemoSnapshotRow | null {
  let found: DemoSnapshotRow | null = null;
  removeSnapshotRow(snapshot, `__no_match_${itemId}`);
  for (const rows of Object.values(snapshot.lanes) as DemoSnapshotRow[][]) {
    const index = rows.findIndex((row) => String(row.snapshot_item_id || row.id) === String(itemId));
    if (index < 0) continue;
    found = rows.splice(index, 1)[0] ?? null;
    if (found) {
      if (!preserveClassification) { found.lane = lane; found.lane_at_snapshot = lane; }
      (found as DemoSnapshotRow & { _lane?: DemoLane })._lane = lane;
    }
    break;
  }
  if (!found) {
    const index = (snapshot.carryover || []).findIndex((row) => String(row.snapshot_item_id || row.id) === String(itemId));
    if (index >= 0) {
      found = snapshot.carryover.splice(index, 1)[0] ?? null;
      if (found) {
        if (!preserveClassification) { found.lane = lane; found.lane_at_snapshot = lane; }
        (found as DemoSnapshotRow & { _lane?: DemoLane })._lane = lane;
      }
    }
  }
  if (found) {
    if (!snapshot.lanes[lane]) snapshot.lanes[lane] = [];
    snapshot.lanes[lane].unshift(found);
  }
  refreshLaneCounts(snapshot);
  return found;
}

export function handleDemoSnapshotRequest({ path, pathname, method, seed, body }: DemoApiRequest): unknown {
  if (pathname === "/api/briefing/email/snoozed" && method === "GET") {
    return Object.entries(seed.snoozedEmails || {}).map(([uid, { row, until_ts, lane }]) => ({
      uid, until_ts, lane, pinned: !!(row as DemoSnapshotRow & { pinned?: boolean }).pinned, subject: row.subject, from_name: row.from_name || "", from_address: row.from_address || "",
      preview: row.summary || "", summary: row.summary || null, action: row.action || null,
      date: row.date || null, read: !!row.read, account_id: row.account_id, verification_code: row.verification_code,
      account_label: seed.activeSnapshot.filters.accounts.find((account) => account.account_id === row.account_id)?.label || null,
      account_email: null, account_color: null, account_icon: "Mail",
      urgency: row.urgency || null, category: row.category || null, handled_at: null, provider_state: null, missing_source: false,
    })).sort((a, b) => a.until_ts - b.until_ts || a.uid.localeCompare(b.uid));
  }
  if (pathname === "/api/briefing/email/mark-all-read" && method === "POST") {
    for (const uid of Array.isArray(body.uids) ? body.uids : []) {
      if (seed.snoozedEmails?.[uid]) seed.snoozedEmails[uid].row.read = true;
      mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = true; });
    }
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/mark-read$/) && method === "POST") {
    const uid = decodeURIComponent(demoPathSegment(pathname, 2));
    if (seed.snoozedEmails?.[uid]) seed.snoozedEmails[uid].row.read = true;
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = true; });
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/mark-unread$/) && method === "POST") {
    const uid = decodeURIComponent(demoPathSegment(pathname, 2));
    if (seed.snoozedEmails?.[uid]) seed.snoozedEmails[uid].row.read = false;
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = false; });
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/pin$/) && (method === "POST" || method === "DELETE")) {
    const uid = decodeURIComponent(demoPathSegment(pathname, 2));
    if (seed.snoozedEmails?.[uid]) (seed.snoozedEmails[uid].row as DemoSnapshotRow & { pinned?: boolean }).pinned = method === "POST";
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => {
      (row as DemoSnapshotRow & { pinned?: boolean }).pinned = method === "POST";
    });
    seed.activeSnapshot.pinned = seed.activeSnapshot.pinned.filter(entry => entry.uid !== uid);
    if (method === "POST") {
      const row = findSnapshotRow(seed.activeSnapshot, uid) || seed.snoozedEmails?.[uid]?.row;
      const saved = (body.snapshot || {}) as Partial<PinnedEmailEntry>;
      seed.activeSnapshot.pinned.push({
        ...saved, uid, pinned_at: new Date().toISOString(), read: !!row?.read,
        subject: row?.subject || saved.subject || "", from_name: row?.from_name || saved.from_name || "",
        from_address: row?.from_address || saved.from_address || "", account_id: row?.account_id || saved.account_id || null,
        lane: row?.lane || saved.lane || null,
      } as PinnedEmailEntry);
    }
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/trash$/) && method === "POST") {
    removeSnapshotRow(seed.activeSnapshot, decodeURIComponent(demoPathSegment(pathname, 2)));
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/snooze$/) && method === "POST") {
    const uid = decodeURIComponent(demoPathSegment(pathname, 2));
    const row = findSnapshotRow(seed.activeSnapshot, uid);
    if (row) {
      seed.snoozedEmails = seed.snoozedEmails || {};
      seed.snoozedEmails[uid] = { row: clone(row), until_ts: Number(body.until_ts), lane: findSnapshotRowLane(seed.activeSnapshot, uid) };
      removeSnapshotRow(seed.activeSnapshot, uid);
    }
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/snooze$/) && method === "DELETE") {
    const uid = decodeURIComponent(demoPathSegment(pathname, 2));
    const stashed = seed.snoozedEmails?.[uid];
    if (stashed) {
      if (stashed.lane === "carryover") {
        seed.activeSnapshot.carryover = [...(seed.activeSnapshot.carryover || []), stashed.row];
      } else {
        const lane = stashed.lane && seed.activeSnapshot.lanes[stashed.lane] ? stashed.lane : "needs_attention";
        seed.activeSnapshot.lanes[lane] = [...(seed.activeSnapshot.lanes[lane] || []), stashed.row];
      }
      refreshLaneCounts(seed.activeSnapshot);
      delete seed.snoozedEmails[uid];
    }
    return { ok: true };
  }

  if (pathname.startsWith("/api/briefing/dismiss/") && method === "POST") {
    removeSnapshotRow(seed.activeSnapshot, decodeURIComponent(demoPathSegment(pathname, 1)));
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/lane$/) && method === "PATCH") {
    const itemId = decodeURIComponent(demoPathSegment(pathname, 2));
    return clone(moveSnapshotRow(seed.activeSnapshot, itemId, body.lane || "fyi") || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/(dismiss|restore|handled|reopen)$/) && method === "POST") {
    const itemId = decodeURIComponent(demoPathSegment(pathname, 2));
    const action = pathname.split("/").slice(-1)[0];
    const snapshot = seed.activeSnapshot;
    const row = allSnapshotRows(snapshot).find(entry => String(entry.snapshot_item_id || entry.id) === itemId);
    if (action === "dismiss" && row) {
      const lane = findSnapshotRowLane(snapshot, row.uid) || row.lane;
      seed.dismissedSnapshotEmails[itemId] = { row: clone(row), lane };
      removeSnapshotRow(snapshot, row.uid);
      return { ok: true };
    }
    if (action === "restore") {
      const stashed = seed.dismissedSnapshotEmails[itemId];
      if (stashed && !row) {
        if (stashed.lane === "carryover") snapshot.carryover.push(stashed.row);
        else snapshot.lanes[stashed.lane].push(stashed.row);
        delete seed.dismissedSnapshotEmails[itemId];
        refreshLaneCounts(snapshot);
      }
      return { ok: true };
    }
    if (row && (action === "handled" || action === "reopen")) {
      const originalLane = row.lane === "handled" ? row.lane_at_snapshot || "needs_attention" : row.lane;
      row.handled_at = action === "handled" ? new Date().toISOString() : null;
      return clone(moveSnapshotRow(snapshot, itemId, action === "handled" ? "handled" : originalLane, true));
    }
    return { ok: true };
  }

  if (pathname === "/api/briefing/snapshot/active" || pathname === "/api/briefing/snapshot/sync") {
    return clone(seed.activeSnapshot);
  }

  if (pathname === "/api/briefing/snapshot/history") {
    return {
      snapshots: [{
        ...clone(seed.activeSnapshot.snapshot),
        laneCounts: clone(seed.activeSnapshot.laneCounts),
        item_count: Object.values(seed.activeSnapshot.laneCounts).reduce((sum, count) => sum + Number(count || 0), 0),
      }],
    };
  }

  if (pathname.startsWith("/api/briefing/snapshot/")) return clone(seed.activeSnapshot);

  const briefingEmailParts = pathname.split("/").filter(Boolean);
  if (briefingEmailParts.length === 4
    && briefingEmailParts[0] === "api"
    && briefingEmailParts[1] === "briefing"
    && briefingEmailParts[2] === "email") {
    const uid = decodeURIComponent(briefingEmailParts[3]!);
    return clone(seed.emailBodies[uid] || demoNotFound(path));
  }

  if (pathname === "/api/briefing/email-search") {
    const query = new URL(path, "http://demo.local").searchParams.get("q") || "";
    const rows = allSnapshotRows(seed.activeSnapshot).filter(row => !query.includes("is:unread") || !row.read).filter(row => !query.includes("is:read") || row.read);
    return { query, results: rows.map(row => ({ ...row, email_date: row.date, body_snippet: row.summary, account_label: seed.activeSnapshot.filters.accounts.find(account => account.account_id === row.account_id)?.label })), accounts: seed.activeSnapshot.filters.accounts, total: rows.length, offset: 0, has_more: false, capped: false };

  }

  return NO_DEMO_API_RESPONSE;
}
