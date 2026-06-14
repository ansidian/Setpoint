// Registry of current-dashboard data providers. Each provider owns one
// ea_current_data_cache key and conforms to:
//
//   {
//     key,                       // cache_key in ea_current_data_cache
//     cacheTtlMs,                // freshness window for the cached row
//     fallbackPayload(),         // payload served when nothing usable is cached
//     hasUsablePayload(payload), // payload-shape check (row may be stale but usable)
//     fetchFresh(userId, config, { dbClient, now, force }), // -> payload (engine persists it)
//
//     // Optional hooks consumed by current-service.js:
//     refreshReasonOverride({ row, now, context }),  // schedule even when fresh (reason string)
//     manualRefreshReason({ row, now, context }),    // always-schedule reason on manual refresh
//     passiveSuppressReason({ row, now, context }),  // veto a scheduled passive refresh (reason string)
//     maintenanceRefreshReason({ row, now, context }), // schedule + force on the maintenance tick
//     onRefreshed(userId, { previousRow, previousPayload }, payload, { now, refreshReason }),
//     visibleProjection(payload),                    // user-visible subset for change detection
//   }
//
// `context` carries cross-provider state loaded by the engine per request:
// { todoistHealth, billsMirror }.
import weatherProvider from "./weather-provider.js";
import calendarProvider from "./calendar-provider.js";
import deadlinesProvider from "./deadlines-provider.js";
import billsProvider from "./bills-provider.js";

export const CURRENT_DATA_PROVIDERS = [
  weatherProvider,
  calendarProvider,
  deadlinesProvider,
  billsProvider,
];

const PROVIDERS_BY_KEY = new Map(CURRENT_DATA_PROVIDERS.map((provider) => [provider.key, provider]));

export function providerFor(key) {
  return PROVIDERS_BY_KEY.get(key) || null;
}
