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

function moveSnapshotRow(snapshot: DemoSnapshot, itemId: string, lane: DemoLane): DemoSnapshotRow | null {
  let found: DemoSnapshotRow | null = null;
  removeSnapshotRow(snapshot, `__no_match_${itemId}`);
  for (const rows of Object.values(snapshot.lanes) as DemoSnapshotRow[][]) {
    const index = rows.findIndex((row) => String(row.snapshot_item_id || row.id) === String(itemId));
    if (index < 0) continue;
    found = rows.splice(index, 1)[0] ?? null;
    if (found) {
      found.lane = lane;
      (found as DemoSnapshotRow & { _lane?: DemoLane })._lane = lane;
    }
    break;
  }
  if (!found) {
    const index = (snapshot.carryover || []).findIndex((row) => String(row.snapshot_item_id || row.id) === String(itemId));
    if (index >= 0) {
      found = snapshot.carryover.splice(index, 1)[0] ?? null;
      if (found) {
        found.lane = lane;
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
  if (pathname === "/api/briefing/email/mark-all-read" && method === "POST") {
    for (const uid of Array.isArray(body.uids) ? body.uids : []) {
      mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = true; });
    }
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/mark-read$/) && method === "POST") {
    const uid = decodeURIComponent(demoPathSegment(pathname, 2));
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = true; });
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/mark-unread$/) && method === "POST") {
    const uid = decodeURIComponent(demoPathSegment(pathname, 2));
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => { row.read = false; });
    return { ok: true };
  }

  if (pathname.match(/^\/api\/briefing\/email\/[^/]+\/pin$/) && (method === "POST" || method === "DELETE")) {
    const uid = decodeURIComponent(demoPathSegment(pathname, 2));
    mutateSnapshotRows(seed.activeSnapshot, uid, (row) => {
      (row as DemoSnapshotRow & { pinned?: boolean }).pinned = method === "POST";
    });
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
      seed.snoozedEmails[uid] = { row: clone(row), lane: findSnapshotRowLane(seed.activeSnapshot, uid) };
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

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/(dismiss|handled)$/) && method === "POST") {
    const itemId = decodeURIComponent(demoPathSegment(pathname, 2));
    return clone(moveSnapshotRow(seed.activeSnapshot, itemId, "handled") || { ok: true });
  }

  if (pathname.match(/^\/api\/briefing\/snapshot\/items\/[^/]+\/(restore|reopen)$/) && method === "POST") {
    const itemId = decodeURIComponent(demoPathSegment(pathname, 2));
    return clone(moveSnapshotRow(seed.activeSnapshot, itemId, "needs_attention") || { ok: true });
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
    return { emails: allSnapshotRows(seed.activeSnapshot), accountsById: {} };
  }

  return NO_DEMO_API_RESPONSE;
}

