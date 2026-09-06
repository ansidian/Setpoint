import { vi, type Mock } from "vitest";
import { createClient, type Client, type InStatement } from "@libsql/client";

type TestMock = Mock<(...args: unknown[]) => unknown>;
interface CurrentServiceTestState {
  db: { current: Client };
  fetchWeather: TestMock;
  fetchCalendar: TestMock;
  fetchTodoistDueTaskIdSet: TestMock;
  fetchTodoistTasks: TestMock;
  getTodoistSyncHealth: TestMock;
  hydrateRecurringTombstones: TestMock;
  readLocalActualMetadata: TestMock;
  getActiveSnapshotView: TestMock;
  syncActiveSnapshot: TestMock;
}

const testState = vi.hoisted((): CurrentServiceTestState => ({
  db: { current: null as unknown as Client },
  fetchWeather: vi.fn(),
  fetchCalendar: vi.fn(),
  fetchTodoistDueTaskIdSet: vi.fn(),
  fetchTodoistTasks: vi.fn(),
  getTodoistSyncHealth: vi.fn(),
  hydrateRecurringTombstones: vi.fn(),
  readLocalActualMetadata: vi.fn(),
  getActiveSnapshotView: vi.fn(),
  syncActiveSnapshot: vi.fn(),
}));

// test-architecture: allow-boundary-mock -- Dashboard cache persistence is exercised through a migrated in-memory database redirected at the shared production connection seam.
vi.mock("../db/connection.ts", () => ({
  default: {
    execute: (statement: string | InStatement) => testState.db.current.execute(statement),
    executeMultiple: (sql: string) => testState.db.current.executeMultiple(sql),
    batch: (statements: InStatement[]) => testState.db.current.batch(statements),
  },
}));
// test-architecture: allow-boundary-mock -- Owner configuration is a database/secret-backed input boundary to dashboard provider composition; cases supply one redacted configured owner.
vi.mock("../platform/config-service.ts", () => ({
  loadUserConfig: vi.fn(async () => ({
    accounts: [
      { id: "gmail-a", type: "gmail", calendar_enabled: true, label: "Work" },
    ],
    settings: {
      weather_lat: 34.1442,
      weather_lng: -117.9981,
      weather_location: "El Monte, CA",
      actual_budget_url: "https://actual.example.test",
    },
  })),
}));
// test-architecture: allow-boundary-mock -- Pirate Weather is an outbound provider boundary; dashboard orchestration cases inject its success, failure, and stall outcomes.
vi.mock("../platform/weather.ts", () => ({
  fetchWeather: (...args: unknown[]) => testState.fetchWeather(...args),
}));
// test-architecture: allow-boundary-mock -- Google Calendar is an outbound provider boundary; dashboard orchestration cases inject its normalized current payload.
vi.mock("../calendar/calendar.ts", () => ({
  fetchCalendar: (...args: unknown[]) => testState.fetchCalendar(...args),
}));
// test-architecture: allow-boundary-mock -- The Todoist mirror/provider facade is the durable external-task boundary consumed by dashboard current-data refreshes.
vi.mock("../tasks/todoist.ts", () => ({
  fetchTodoistDueTaskIdSet: (...args: unknown[]) => testState.fetchTodoistDueTaskIdSet(...args),
  fetchTodoistTasks: (...args: unknown[]) => testState.fetchTodoistTasks(...args),
  fetchTodoistTasksAll: (...args: unknown[]) => testState.fetchTodoistTasks(...args),
  fetchTodoistTasksRange: (...args: unknown[]) => testState.fetchTodoistTasks(...args),
  getTodoistSyncHealth: (...args: unknown[]) => testState.getTodoistSyncHealth(...args),
}));
// test-architecture: allow-boundary-mock -- Completed-occurrence tombstones are a separate durable task-history boundary; composition cases inject their projected rows rather than their SQL lifecycle.
vi.mock("../tasks/tombstones.ts", () => ({
  hydrateRecurringTombstones: (...args: unknown[]) => testState.hydrateRecurringTombstones(...args),
}));
// test-architecture: allow-boundary-mock -- Actual's local metadata reader is the filesystem/provider boundary; the real Bills mirror and dashboard services persist and compose its result.
vi.mock("../actual/actual-local-metadata.ts", () => ({
  readLocalActualMetadata: (...args: unknown[]) => testState.readLocalActualMetadata(...args),
}));
// test-architecture: allow-boundary-mock -- Active snapshots are a separately persisted briefing boundary; dashboard tests compose controlled snapshot views while snapshot lifecycle suites own their durable behavior.
vi.mock("../snapshots/snapshot-service.ts", () => ({
  getActiveSnapshotView: (...args: unknown[]) => testState.getActiveSnapshotView(...args),
  syncActiveSnapshot: (...args: unknown[]) => testState.syncActiveSnapshot(...args),
}));

process.env.EA_USER_ID = "u1";

const EMPTY_DEADLINES_FOR_TEST = {
  upcoming: [],
  stats: null,
};

const ACTUAL_METADATA_FOR_TEST = {
  accounts: [{ id: "checking", name: "Checking" }],
  payees: [{ id: "payee-synced", name: "Synced Payee" }],
  payeeMap: { "payee-synced": "Synced Payee" },
  categories: [],
  schedules: [{
    id: "synced-bill",
    name: "Synced Bill",
    next_date: "2026-05-04",
    type: "bill",
    conditions: [
      { field: "payee", value: "payee-synced" },
      { field: "amount", value: -12345 },
    ],
  }],
  recentTransactions: [],
};

const {
  applyDeadlineCurrentStatus,
  clearCurrentDashboardRefreshState,
  getCurrentDashboard,
  getDashboardSystemHealth,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
} = await import("./current-service.ts");
const { markRowsRefreshing, markCacheRowRefreshFailed } = await import("./currentCacheStore.ts");

async function createMigratedDb() {
  const db = createClient({ url: "file::memory:" });
  await db.executeMultiple(`
    CREATE TABLE ea_current_data_cache (
      user_id TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      payload_json TEXT,
      fetched_at TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'current',
      error_message TEXT,
      refresh_started_at TEXT,
      last_refresh_failed_at TEXT,
      last_refresh_error TEXT,
      refresh_failure_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, cache_key)
    );

    CREATE TABLE ea_bills_mirror_state (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'needs_sync',
      actual_configured INTEGER NOT NULL DEFAULT 0,
      actual_budget_url TEXT,
      last_success_at TEXT,
      last_attempt_at TEXT,
      last_error TEXT,
      pending_refresh_at TEXT,
      refresh_started_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE ea_bill_schedule_mirror (
      user_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      name TEXT NOT NULL,
      payee TEXT,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      next_date TEXT NOT NULL,
      paid INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, schedule_id)
    );

    CREATE TABLE ea_bill_occurrence_mirror (
      user_id TEXT NOT NULL,
      occurrence_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      occurrence_date TEXT NOT NULL,
      name TEXT NOT NULL,
      payee TEXT,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      paid INTEGER NOT NULL DEFAULT 0,
      open_action_disabled INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, occurrence_id)
    );

    CREATE TABLE ea_actual_metadata_mirror (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'needs_sync',
      accounts_json TEXT,
      payees_json TEXT,
      categories_json TEXT,
      schedules_json TEXT,
      recent_transactions_json TEXT,
      last_success_at TEXT,
      last_attempt_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE ea_reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reminder_kind TEXT NOT NULL DEFAULT 'fixed',
      source_type TEXT NOT NULL,
      source_account_id TEXT,
      source_calendar_id TEXT,
      source_item_id TEXT NOT NULL,
      source_occurrence_id TEXT,
      anchor_kind TEXT NOT NULL,
      anchor_at TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL,
      remind_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_after TEXT,
      payload_snapshot_json TEXT,
      arrival_buffer_minutes INTEGER,
      route_duration_seconds INTEGER,
      route_distance_meters INTEGER,
      route_checked_at TEXT,
      next_route_check_at TEXT,
      route_status TEXT,
      route_error_code TEXT,
      sent_at TEXT,
      missed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE ea_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      email TEXT,
      label TEXT,
      calendar_enabled INTEGER NOT NULL DEFAULT 1,
      needs_reauth INTEGER NOT NULL DEFAULT 0
    );

    INSERT INTO ea_accounts (id, user_id, type, email) VALUES ('gmail-a', 'u1', 'gmail', 'a@example.test');

    CREATE TABLE ea_settings (
      user_id TEXT PRIMARY KEY,
      todoist_needs_reauth INTEGER NOT NULL DEFAULT 0,
      actual_budget_url TEXT
    );
    INSERT INTO ea_settings (user_id, actual_budget_url) VALUES ('u1', 'https://actual.example.test');
  `);
  return db;
}

async function seedCache(
  cacheKey: string,
  payload: unknown,
  { fetchedAt, expiresAt }: { fetchedAt?: string; expiresAt?: string } = {},
) {
  await testState.db.current.execute({
    sql: `INSERT INTO ea_current_data_cache
            (user_id, cache_key, payload_json, fetched_at, expires_at, status, updated_at)
          VALUES (?, ?, ?, ?, ?, 'current', ?)`,
    args: [
      "u1",
      cacheKey,
      JSON.stringify(payload),
      fetchedAt || new Date().toISOString(),
      expiresAt || new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(),
    ],
  });
}

async function getCurrentResponse() {
  return {
    status: 200,
    body: await getCurrentDashboard("u1", { dbClient: testState.db.current }),
  };
}

async function requestRefreshResponse() {
  return {
    status: 200,
    body: await requestCurrentDashboardRefresh("u1", { dbClient: testState.db.current }),
  };
}

async function syncResponse(now = new Date("2026-05-04T12:00:00.000Z")) {
  return {
    status: 200,
    body: await syncCurrentDashboard("u1", { dbClient: testState.db.current, now }),
  };
}

export async function setupCurrentServiceTest() {
  testState.db.current = await createMigratedDb();
  delete process.env.EA_DASHBOARD_SYNC_SNAPSHOT_TIMEOUT_MS;
  delete process.env.EA_DASHBOARD_PROVIDER_FETCH_TIMEOUT_MS;
  testState.fetchWeather.mockReset().mockResolvedValue({ temp: 72 });
  testState.fetchCalendar.mockReset().mockResolvedValue([]);
  testState.fetchTodoistTasks.mockReset().mockResolvedValue([]);
  testState.fetchTodoistDueTaskIdSet.mockReset().mockResolvedValue(new Set());
  testState.getTodoistSyncHealth.mockReset().mockResolvedValue({
    state: "current",
    configured: true,
    lastSuccessAt: "2026-05-04T12:00:00.000Z",
    lastError: null,
    syncStartedAt: null,
    ageMs: 30_000,
  });
  testState.hydrateRecurringTombstones.mockReset().mockResolvedValue([]);
  testState.readLocalActualMetadata.mockReset().mockResolvedValue(ACTUAL_METADATA_FOR_TEST);
  testState.getActiveSnapshotView.mockReset().mockResolvedValue({
    snapshot: { id: 42 },
    lanes: { needs_attention: [], fyi: [], noise: [] },
    carryover: [],
    laneCounts: { needs_attention: 0, fyi: 0, noise: 0, carryover: 0 },
  });
  testState.syncActiveSnapshot.mockReset().mockResolvedValue({ snapshot: { id: 43 } });
}

export async function cleanupCurrentServiceTest() {
  clearCurrentDashboardRefreshState();
  await testState.db.current?.close?.();
  testState.db.current = null as unknown as Client;
}

export {
  testState,
  EMPTY_DEADLINES_FOR_TEST,
  ACTUAL_METADATA_FOR_TEST,
  applyDeadlineCurrentStatus,
  clearCurrentDashboardRefreshState,
  getCurrentDashboard,
  getDashboardSystemHealth,
  requestCurrentDashboardRefresh,
  syncCurrentDashboard,
  markRowsRefreshing,
  markCacheRowRefreshFailed,
  seedCache,
  getCurrentResponse,
  requestRefreshResponse,
  syncResponse
};
