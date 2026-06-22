// Pure view projection for the briefing snapshot: sorts/aggregates loaded snapshot
// items into the lane/filter/laneCount shape the briefing UI consumes. No DB — the
// store (snapshotStore.js) loads rows, the service orchestrates, this shapes the view.

export function compareAccountFilters(accountOrder, a, b) {
  const aOrder = accountOrder.get(a.account_id);
  const bOrder = accountOrder.get(b.account_id);
  if (aOrder && bOrder) {
    if (aOrder.sort_order !== bOrder.sort_order) return aOrder.sort_order - bOrder.sort_order;
    if (aOrder.created_at !== bOrder.created_at) return aOrder.created_at - bOrder.created_at;
    return aOrder.index - bOrder.index;
  }
  if (aOrder) return -1;
  if (bOrder) return 1;

  return a.label.localeCompare(b.label) || a.account_id.localeCompare(b.account_id);
}

export function buildFilters(items, accountOrder = null) {
  const accountMap = new Map();
  const categoryMap = new Map();

  for (const item of items) {
    const existingAccount = accountMap.get(item.account_id);
    if (existingAccount) {
      existingAccount.count += 1;
    } else {
      accountMap.set(item.account_id, {
        account_id: item.account_id,
        label: item.account_label,
        email: item.account_email,
        color: item.account_color,
        icon: item.account_icon,
        count: 1,
      });
    }

    const category = item.category || "uncategorized";
    categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
  }

  return {
    accounts: [...accountMap.values()].sort((a, b) => (
      accountOrder
        ? compareAccountFilters(accountOrder, a, b)
        : b.count - a.count || a.label.localeCompare(b.label)
    )),
    categories: [...categoryMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => a.category.localeCompare(b.category)),
  };
}

export function buildLanes(items) {
  const lanes = {
    queued: [],
    needs_attention: [],
    fyi: [],
    handled: [],
    untriaged_read: [],
    noise: [],
  };
  const carryover = [];

  for (const item of items) {
    if (item.handled_at) {
      lanes.handled.push(item);
      continue;
    }
    if (item.is_carryover) {
      carryover.push(item);
      continue;
    }
    if (item.lane === "catch_up") {
      if (!lanes.catch_up) lanes.catch_up = [];
      lanes.catch_up.push(item);
      continue;
    }
    if (lanes[item.lane]) lanes[item.lane].push(item);
  }

  return { lanes, carryover };
}

export function emptyProcessingState() {
  return {
    queued: 0,
    running: 0,
    total: 0,
    active: false,
    email_triage_mode: "auto",
    effective_email_triage_mode: "no_model",
    email_triage: {
      pending: 0,
      queued: 0,
      running: 0,
      total: 0,
      active: false,
    },
    gmail_history_sync: {
      pending: 0,
      queued: 0,
      running: 0,
      total: 0,
      active: false,
    },
  };
}

export function buildSnapshotView(snapshot, items, processing = emptyProcessingState(), accountOrder = null, carryoverAgedOut = 0) {
  const { lanes, carryover } = buildLanes(items);
  const laneCounts = {
    queued: lanes.queued.length,
    needs_attention: lanes.needs_attention.length,
    fyi: lanes.fyi.length,
    handled: lanes.handled.length,
    untriaged_read: lanes.untriaged_read.length,
    noise: lanes.noise.length,
    carryover: carryover.length,
  };
  if (lanes.catch_up?.length > 0) laneCounts.catch_up = lanes.catch_up.length;
  return {
    snapshot,
    readOnly: snapshot?.status !== "active",
    lanes,
    carryover,
    carryoverAgedOut,
    laneCounts,
    processing,
    filters: buildFilters(items, accountOrder),
  };
}
