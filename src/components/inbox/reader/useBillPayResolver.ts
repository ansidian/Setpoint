import { useCallback, useEffect, useRef, useState } from "react";
import { resolveFinancialEmailPlan } from "../../../api";
import { resolveBillExtractionBody } from "./billExtractionBody";
import type { BillPaySeedRequest, FinancialEmailPlan } from "../../../../shared/types/bills";
import type { InboxEmailLike } from "../inboxTypes";
import { asBillCandidate } from "./readerTypes";
import type { BillResolutionState, BillResolutionValue, EmailBodyStateInput } from "./readerTypes";

const BILL_RESOLUTION_TTL_MS = 5 * 60 * 1000;
const BILL_RESOLUTION_CACHE_MAX = 50;
interface SharedCacheEntry {
  value: BillResolutionValue | null;
  promise: Promise<BillResolutionValue> | null;
  expiresAt: number;
}
const billResolutionCache = new Map<string, SharedCacheEntry>();
let billResolutionCacheGeneration = 0;

function clearBillResolutionCache(): void {
  billResolutionCache.clear();
  billResolutionCacheGeneration += 1;
}

function pruneBillResolutionCache(now: number): void {
  for (const [key, entry] of billResolutionCache) {
    if (entry.expiresAt <= now) billResolutionCache.delete(key);
  }
  while (billResolutionCache.size > BILL_RESOLUTION_CACHE_MAX) {
    const oldest = billResolutionCache.keys().next().value;
    if (oldest === undefined) break;
    billResolutionCache.delete(oldest);
  }
}

function resolvedValue(result: FinancialEmailPlan): BillResolutionValue {
  return {
    plan: result || null,
    resolvedBill: result?.candidate || null,
    actualStatus: result?.reconciliation || null,
  };
}

function loadBillResolution(key: string, payload: BillPaySeedRequest): SharedCacheEntry {
  const now = Date.now();
  const cached = billResolutionCache.get(key);
  if (cached && cached.expiresAt > now) {
    billResolutionCache.delete(key);
    billResolutionCache.set(key, cached);
    return cached;
  }
  if (cached) billResolutionCache.delete(key);

  const generation = billResolutionCacheGeneration;
  const entry: SharedCacheEntry = {
    value: null,
    promise: null,
    expiresAt: now + BILL_RESOLUTION_TTL_MS,
  };
  const promise = resolveFinancialEmailPlan(payload)
    .then((result) => {
      const value = resolvedValue(result);
      if (
        generation === billResolutionCacheGeneration
        && billResolutionCache.get(key) === entry
      ) {
        entry.value = value;
        entry.promise = null;
        entry.expiresAt = Date.now() + BILL_RESOLUTION_TTL_MS;
      }
      return value;
    })
    .catch((error: unknown) => {
      if (billResolutionCache.get(key) === entry) billResolutionCache.delete(key);
      throw error;
    });
  entry.promise = promise;
  billResolutionCache.set(key, entry);
  pruneBillResolutionCache(now);
  return entry;
}

if (typeof window !== "undefined") {
  window.addEventListener("ea-settings-changed", clearBillResolutionCache);
  window.addEventListener("ea-actual-metadata-invalidated", clearBillResolutionCache);
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === "ea_settings_changed") clearBillResolutionCache();
  });
}

function emailKey(email: InboxEmailLike | null | undefined): string | null {
  const key = email?.uid || email?.id || email?.email_id;
  return key == null ? null : String(key);
}

function billResolutionKey(email: InboxEmailLike | null | undefined): string | null {
  const id = emailKey(email);
  return id ? `${email?.account_id || ""}:${id}` : null;
}

function senderForEmail(email: InboxEmailLike): string {
  return email?.fromEmail || email?.from_address || email?.from || "";
}

function snippetForEmail(email: InboxEmailLike): string {
  return email?.preview || email?.body_snippet || email?.summary || "";
}

interface BillResolutionCache {
  key: string | null;
  value: BillResolutionValue | null;
  promise: Promise<BillResolutionValue> | null;
}

export default function useBillPayResolver({ email, billOpen, bodyState }: {
  email: InboxEmailLike | null;
  billOpen: boolean;
  bodyState: EmailBodyStateInput;
}): BillResolutionState {
  const emailId = emailKey(email);
  const key = billResolutionKey(email);
  const cacheRef = useRef<BillResolutionCache>({ key: null, value: null, promise: null });
  const [state, setState] = useState<BillResolutionState>({
    key: null,
    status: "idle",
    plan: null,
    resolvedBill: null,
    actualStatus: null,
    error: null,
  });
  const [settingsVersion, setSettingsVersion] = useState(0);
  const extractionBody = resolveBillExtractionBody(bodyState);
  const shouldResolve = !!(
    billOpen || email?.hasBill || email?.bill_candidate || email?.extractedBill
  );

  const retry = useCallback(() => {
    if (!key) return;
    billResolutionCache.delete(key);
    cacheRef.current = { key, value: null, promise: null };
    setSettingsVersion((value) => value + 1);
  }, [key]);

  useEffect(() => {
    const workflow = state.plan?.workflow;
    if (!key || state.key !== key || !workflow || !["pending", "waiting"].includes(workflow.state)) return;
    const timer = window.setInterval(() => {
      if (cacheRef.current.promise) return;
      billResolutionCache.delete(key);
      cacheRef.current = { key, value: null, promise: null };
      setSettingsVersion((value) => value + 1);
    }, workflow.state === "pending" ? 3_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [key, state.key, state.plan]);

  useEffect(() => {
    cacheRef.current = { key, value: null, promise: null };
  }, [key]);

  useEffect(() => {
    const onFinancialChange = (event: Event) => {
      const detail = (event as CustomEvent<{ emailUid: string; plan?: FinancialEmailPlan }>).detail;
      if (!key || detail?.emailUid !== emailId) return;
      billResolutionCache.delete(key);
      const value = detail.plan ? resolvedValue(detail.plan) : null;
      cacheRef.current = { key, value, promise: null };
      if (value) setState({ key, status: "resolved", ...value, error: null });
      setSettingsVersion((version) => version + 1);
    };
    window.addEventListener("ea-financial-event-changed", onFinancialChange);
    return () => window.removeEventListener("ea-financial-event-changed", onFinancialChange);
  }, [emailId, key]);

  useEffect(() => {
    const reset = () => {
      cacheRef.current = { key: cacheRef.current.key, value: null, promise: null };
      setState((current) => current.plan?.workflow ? { ...current, status: "loading", error: null } : {
        key: cacheRef.current.key,
        status: "idle",
        plan: null,
        resolvedBill: null,
        actualStatus: null,
        error: null,
      });
      setSettingsVersion((value) => value + 1);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "ea_settings_changed") reset();
    };
    window.addEventListener("ea-settings-changed", reset);
    window.addEventListener("ea-actual-metadata-invalidated", reset);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("ea-settings-changed", reset);
      window.removeEventListener("ea-actual-metadata-invalidated", reset);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!shouldResolve || !email || !key || extractionBody.loading) return;
    if (cacheRef.current.key !== key) {
      cacheRef.current = { key, value: null, promise: null };
    }
    if (cacheRef.current.value) {
      const value = cacheRef.current.value;
      setState((current) => (
        current.status === "resolved"
          && current.resolvedBill === value.resolvedBill
          && current.plan === value.plan
          ? current
          : { key, status: "resolved", ...value, error: null }
      ));
      return;
    }
    if (cacheRef.current.promise) return;

    const payload: BillPaySeedRequest = {
      emailId,
      accountId: email.account_id,
      subject: email.subject || "",
      from: senderForEmail(email),
      snippet: snippetForEmail(email),
      body: extractionBody.source === "loaded" ? extractionBody.body : undefined,
      candidate: asBillCandidate(email.bill_candidate || email.extractedBill),
      source: email.hasBill || email.bill_candidate ? "triage" : "reader",
    };
    setState((current) => current.key === key ? { ...current, status: "loading", error: null }
      : { key, status: "loading", plan: null, resolvedBill: null, actualStatus: null, error: null });
    const cached = loadBillResolution(key, payload);
    if (cached.value) {
      cacheRef.current = { key, value: cached.value, promise: null };
      setState({ key, status: "resolved", ...cached.value, error: null });
      return;
    }

    const promise = cached.promise;
    if (!promise) return;
    cacheRef.current = { key, value: null, promise };
    promise
      .then((value) => {
        if (cacheRef.current.key === key && cacheRef.current.promise === promise) {
          cacheRef.current.value = value;
          cacheRef.current.promise = null;
          setState({ key, status: "resolved", ...value, error: null });
        }
        return value;
      })
      .catch((error: unknown) => {
        if (cacheRef.current.key === key && cacheRef.current.promise === promise) {
          cacheRef.current.promise = null;
          setState((current) => current.key === key && current.plan?.workflow ? { ...current, status: "error", error } : {
            key,
            status: "error",
            plan: null,
            resolvedBill: null,
            actualStatus: null,
            error,
          });
        }
      });
  }, [email, emailId, extractionBody.body, extractionBody.loading, extractionBody.source, key, settingsVersion, shouldResolve]);

  return state.key === key
    ? { ...state, retry }
    : {
        key,
        status: "idle",
        plan: null,
        resolvedBill: null,
        actualStatus: null,
        error: null,
        retry,
      };
}
