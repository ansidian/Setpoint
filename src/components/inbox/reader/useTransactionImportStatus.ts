import { useCallback, useEffect, useRef, useState } from "react";
import { getTransactionImportEmailStatus } from "@/api";
import { hasActiveTransactionImport } from "./transactionImportStatusModel";
import type { TransactionImportItem } from "../../../../shared/types/transaction-imports";

export default function useTransactionImportStatus(emailUid: string) {
  const [result, setResult] = useState<{ emailUid: string; items: TransactionImportItem[]; error: boolean }>({
    emailUid: "",
    items: [],
    error: false,
  });
  const requestRef = useRef(0);
  const mountedRef = useRef(false);
  const items = result.emailUid === emailUid ? result.items : [];
  const error = result.emailUid === emailUid && result.error;
  const active = hasActiveTransactionImport(items);

  const refresh = useCallback(async () => {
    if (!emailUid) {
      return;
    }
    const requestId = ++requestRef.current;
    try {
      const response = await getTransactionImportEmailStatus(emailUid);
      if (mountedRef.current && requestId === requestRef.current) {
        setResult({ emailUid, items: response.items, error: false });
      }
    } catch {
      if (mountedRef.current && requestId === requestRef.current) {
        setResult({ emailUid, items: [], error: true });
      }
    }
  }, [emailUid]);

  useEffect(() => {
    mountedRef.current = true;
    if (emailUid) {
      const requestId = ++requestRef.current;
      void getTransactionImportEmailStatus(emailUid)
        .then((response) => {
          if (mountedRef.current && requestId === requestRef.current) {
            setResult({ emailUid, items: response.items, error: false });
          }
        })
        .catch(() => {
          if (mountedRef.current && requestId === requestRef.current) {
            setResult({ emailUid, items: [], error: true });
          }
        });
    }
    return () => {
      mountedRef.current = false;
    };
  }, [emailUid]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (!active) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3_000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, refresh]);

  return { items, error };
}
