export { readActualMetadataProjection } from './actual-metadata-projection.ts';
import { runActualWorkerOperation, stopActualWorker as stopWorker } from "./actual-worker.ts";
import { testActualConnectionHttp } from "./actual-connection-test.ts";
import type { CacheDescription } from "./actual-local-metadata.ts";
import type { ActualWorkerOperation, ActualWorkerOptions } from "./actual-worker-protocol.ts";
import type { ActualMetadata } from "../../shared/types/actual.ts";

export type { ActualConnectionCandidate } from "./actual-connection-settings.ts";
import type { ActualConnectionCandidate } from "./actual-connection-settings.ts";

export async function saveActualConnectionCandidate(userId: string, candidate: ActualConnectionCandidate) {
  const service = await import("./actual-connection-settings.ts");
  const result = await service.saveActualConnectionCandidate(userId, candidate);
  await callActual<void>("shutdownActual", []);
  return result;
}

export async function removeActualConnection(userId: string) {
  const service = await import("./actual-connection-settings.ts");
  const result = await service.removeActualConnection(userId);
  await callActual<void>("shutdownActual", []);
  return result;
}

// Read-only transaction consumers use the same domain facade without starting the SDK.
export { readJournalRange } from './actual-journal-read.ts';

function shouldUseInProcessActual(): boolean {
  return process.env.NODE_ENV === "test" || process.env.EA_ACTUAL_WORKER_DISABLED === "1";
}

async function callActual<T>(operation: ActualWorkerOperation, args: unknown[], options: ActualWorkerOptions = {}): Promise<T> {
  if (shouldUseInProcessActual()) {
    const core = await import("./actual-core.ts");
    const handler: unknown = Reflect.get(core, operation);
    if (typeof handler !== "function") throw Object.assign(new Error(`Unknown Actual operation: ${operation}`), { status: 400 });
    return await Reflect.apply(handler, core, args) as T;
  }
  return runActualWorkerOperation(operation, args, options);
}

export async function stopActualWorker(): Promise<void> {
  if (shouldUseInProcessActual()) return callActual<void>("shutdownActual", []);
  await stopWorker();
}

export async function hydrateActualCache(userId: string) {
  return callActual<CacheDescription>("hydrateCache", [userId]);
}

// Sync and project inside the worker's serialized session. Parent readers never
// mutate the on-disk budget behind the SDK's loaded state.
export async function syncActualMetadata(userId: string): Promise<ActualMetadata> {
  return callActual<ActualMetadata>("syncMetadata", [userId]);
}

export function testConnection(userId: string, overrides: Parameters<typeof testActualConnectionHttp>[1] = null) {
  return testActualConnectionHttp(userId, overrides);
}
