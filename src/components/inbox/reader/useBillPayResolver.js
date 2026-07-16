import { useEffect, useRef, useState } from "react";
import { resolveBillPaySeed } from "../../../api.js";
import { resolveBillExtractionBody } from "./billExtractionBody.js";

function emailKey(email) {
  return email?.uid || email?.id || email?.email_id || null;
}

function senderForEmail(email) {
  return email?.fromEmail || email?.from_address || email?.from || "";
}

function snippetForEmail(email) {
  return email?.preview || email?.body_snippet || email?.summary || "";
}

export default function useBillPayResolver({ email, billOpen, bodyState }) {
  const key = emailKey(email);
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
      emailId: key,
      accountId: email.account_id,
      subject: email.subject || "",
      from: senderForEmail(email),
      snippet: snippetForEmail(email),
      body: extractionBody.source === "loaded" ? extractionBody.body : undefined,
      candidate: email.bill_candidate || email.extractedBill || null,
      source: email.hasBill || email.bill_candidate ? "triage" : "reader",
    };
    setState((current) => ({ ...current, key, status: "loading", error: null }));
    const promise = resolveBillPaySeed(payload)
      .then((result) => {
        const value = {
          resolvedBill: result?.bill || null,
          mapping: result?.mapping || null,
          actualStatus: result?.actualStatus || null,
        };
        if (cacheRef.current.key === key) {
          cacheRef.current.value = value;
          cacheRef.current.promise = null;
          setState({ key, status: "resolved", ...value, error: null });
        }
        return value;
      })
      .catch((error) => {
        if (cacheRef.current.key === key) {
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
    cacheRef.current = { key, value: null, promise };
  }, [email, extractionBody.body, extractionBody.loading, extractionBody.source, key, settingsVersion, shouldResolve]);

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
