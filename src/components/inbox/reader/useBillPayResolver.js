import { useEffect, useRef, useState } from "react";
import { resolveBillPaySeed } from "../../../api";
import { resolveBillExtractionBody } from "./billExtractionBody.js";

const BILL_RESOLUTION_TTL_MS = 5 * 60 * 1000;
const BILL_RESOLUTION_CACHE_MAX = 50;
const billResolutionCache = new Map();
let billResolutionCacheGeneration = 0;

function clearBillResolutionCache() {
  billResolutionCache.clear();
  billResolutionCacheGeneration += 1;
}

function pruneBillResolutionCache(now) {
  for (const [key, entry] of billResolutionCache) {
    if (entry.expiresAt <= now) billResolutionCache.delete(key);
  }
  while (billResolutionCache.size > BILL_RESOLUTION_CACHE_MAX) {
    const oldest = billResolutionCache.keys().next().value;
    if (oldest === undefined) break;
    billResolutionCache.delete(oldest);
  }
}

function resolvedValue(result) {
  return {
    resolvedBill: result?.bill || null,
    mapping: result?.mapping || null,
    actualStatus: result?.actualStatus || null,
  };
}

function loadBillResolution(key, payload) {
  const now = Date.now();
  const cached = billResolutionCache.get(key);
  if (cached && cached.expiresAt > now) {
    billResolutionCache.delete(key);
    billResolutionCache.set(key, cached);
    return cached;
  }
  if (cached) billResolutionCache.delete(key);

  const generation = billResolutionCacheGeneration;
  const entry = {
    value: null,
    promise: null,
    expiresAt: now + BILL_RESOLUTION_TTL_MS,
  };
  const promise = resolveBillPaySeed(payload)
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
    .catch((error) => {
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
  window.addEventListener("storage", (event) => {
    if (event.key === "ea_settings_changed") clearBillResolutionCache();
  });
}

function emailKey(email) {
  return email?.uid || email?.id || email?.email_id || null;
}

function billResolutionKey(email) {
  const id = emailKey(email);
  return id ? `${email?.account_id || ""}:${id}` : null;
}

function senderForEmail(email) {
  return email?.fromEmail || email?.from_address || email?.from || "";
}

function snippetForEmail(email) {
  return email?.preview || email?.body_snippet || email?.summary || "";
}

export default function useBillPayResolver({ email, billOpen, bodyState }) {
  const emailId = emailKey(email);
  const key = billResolutionKey(email);
  const cacheRef = useRef({ key: null, value: null, promise: null });
  const [state, setState] = useState({
    key: null,
    status: "idle",
    resolvedBill: null,
    mapping: null,
    actualStatus: null,
    error: null,
  });
  const [settingsVersion, setSettingsVersion] = useState(0);
  const extractionBody = resolveBillExtractionBody(bodyState);
  const shouldResolve = !!(
    billOpen || email?.hasBill || email?.bill_candidate || email?.extractedBill
  );

  useEffect(() => {
    cacheRef.current = { key, value: null, promise: null };
  }, [key]);

  useEffect(() => {
    const reset = () => {
      cacheRef.current = { key: cacheRef.current.key, value: null, promise: null };
      setState({
        key: cacheRef.current.key,
        status: "idle",
        resolvedBill: null,
        mapping: null,
        actualStatus: null,
        error: null,
      });
      setSettingsVersion((value) => value + 1);
    };
    const handleStorage = (event) => {
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
          && current.mapping === value.mapping
          ? current
          : { key, status: "resolved", ...value, error: null }
      ));
      return;
    }
    if (cacheRef.current.promise) return;

    const payload = {
      emailId,
      accountId: email.account_id,
      subject: email.subject || "",
      from: senderForEmail(email),
      snippet: snippetForEmail(email),
      body: extractionBody.source === "loaded" ? extractionBody.body : undefined,
      candidate: email.bill_candidate || email.extractedBill || null,
      source: email.hasBill || email.bill_candidate ? "triage" : "reader",
    };
    setState((current) => ({ ...current, key, status: "loading", error: null }));
    const cached = loadBillResolution(key, payload);
    if (cached.value) {
      cacheRef.current = { key, value: cached.value, promise: null };
      setState({ key, status: "resolved", ...cached.value, error: null });
      return;
    }

    const promise = cached.promise;
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
      .catch((error) => {
        if (cacheRef.current.key === key && cacheRef.current.promise === promise) {
          cacheRef.current.promise = null;
          setState({
            key,
            status: "error",
            resolvedBill: null,
            mapping: null,
            actualStatus: null,
            error,
          });
        }
      });
  }, [email, emailId, extractionBody.body, extractionBody.loading, extractionBody.source, key, settingsVersion, shouldResolve]);

  return state.key === key
    ? state
    : {
        key,
        status: "idle",
        resolvedBill: null,
        mapping: null,
        actualStatus: null,
        error: null,
      };
}
