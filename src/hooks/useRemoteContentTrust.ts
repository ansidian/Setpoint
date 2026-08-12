import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getRemoteContentTrust,
  removeRemoteContentTrust as removeRemoteContentTrustRequest,
  trustRemoteContentSender as trustRemoteContentSenderRequest,
} from "@/api";
import type { RemoteContentTrustEntry } from "../../shared/types/email";

type RegistryStatus = "idle" | "loading" | "loaded" | "error";

interface RegistrySnapshot {
  status: RegistryStatus;
  entries: RemoteContentTrustEntry[];
  error: string | null;
}

let registrySnapshot: RegistrySnapshot = {
  status: "idle",
  entries: [],
  error: null,
};
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: RegistrySnapshot) {
  registrySnapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return registrySnapshot;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeIdentityPart(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isValidSenderAddress(value: string): boolean {
  return value.length > 0 && value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value);
}

async function loadRegistry({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (!force && registrySnapshot.status === "loaded") return;
  if (loadPromise) return loadPromise;
  emit({ ...registrySnapshot, status: "loading", error: null });
  loadPromise = getRemoteContentTrust()
    .then((entries) => {
      emit({ status: "loaded", entries: entries || [], error: null });
    })
    .catch((error: unknown) => {
      emit({
        ...registrySnapshot,
        status: "error",
        error: errorMessage(error, "Could not load trusted senders."),
      });
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

async function addTrust(accountId: string, senderAddress: string): Promise<void> {
  const response = await trustRemoteContentSenderRequest(accountId, senderAddress);
  const entry = response.entry;
  if (!entry) throw new Error("Setpoint saved the preference but could not reload it.");
  const entries = [
    entry,
    ...registrySnapshot.entries.filter((candidate) => candidate.id !== entry.id),
  ];
  emit({ status: "loaded", entries, error: null });
}

async function removeTrust(id: number): Promise<void> {
  await removeRemoteContentTrustRequest(id);
  emit({
    status: "loaded",
    entries: registrySnapshot.entries.filter((entry) => entry.id !== id),
    error: null,
  });
}

export type RemoteContentTrustStatus = "loading" | "trusted" | "untrusted";

export function useRemoteContentTrust(accountIdValue: unknown, senderAddressValue: unknown) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const accountId = String(accountIdValue || "").trim();
  const senderAddress = normalizeIdentityPart(senderAddressValue);
  const hasIdentity = Boolean(accountId) && isValidSenderAddress(senderAddress);

  useEffect(() => {
    if (hasIdentity) void loadRegistry();
  }, [hasIdentity]);

  const trusted = hasIdentity && snapshot.entries.some((entry) =>
    entry.account_id === accountId && entry.sender_address.toLowerCase() === senderAddress);
  const status: RemoteContentTrustStatus = !hasIdentity
    ? "untrusted"
    : snapshot.status === "idle" || snapshot.status === "loading"
      ? "loading"
      : trusted ? "trusted" : "untrusted";

  const trustSender = useCallback(async () => {
    if (!hasIdentity) throw new Error("This message does not have a trusted-sender identity.");
    await addTrust(accountId, senderAddress);
  }, [accountId, hasIdentity, senderAddress]);

  return {
    status,
    senderAddress: hasIdentity ? senderAddress : null,
    trustSender: hasIdentity ? trustSender : null,
  };
}

export function useRemoteContentTrustRegistry() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void loadRegistry();
  }, []);

  return {
    entries: snapshot.entries,
    loading: snapshot.status === "idle" || snapshot.status === "loading",
    error: snapshot.error,
    reload: () => loadRegistry({ force: true }),
    removeTrust,
  };
}
