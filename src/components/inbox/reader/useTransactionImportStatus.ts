import { useCallback, useEffect, useRef, useState } from "react";
import { getTransactionImportEmailStatus } from "@/api";
import { hasActiveTransactionImport } from "./transactionImportStatusModel";
import type { TransactionImportItem } from "../../../../shared/types/transaction-imports";
import type { FinancialEmailPlan } from "../../../../shared/types/bills";

export default function useTransactionImportStatus(emailUid: string, { pollAllStates = false }: { pollAllStates?: boolean } = {}) {
  const [result, setResult] = useState<{ emailUid: string; items: TransactionImportItem[]; financialEvent: FinancialEmailPlan | null; error: boolean }>({
    emailUid: "",
    items: [],
    financialEvent: null,
    error: false,
  });
  const requestRef = useRef(0);
  const mountedRef = useRef(false);
  const items = result.emailUid === emailUid ? result.items : [];
  const error = result.emailUid === emailUid && result.error;
  const financialEvent = result.emailUid === emailUid ? result.financialEvent : null;
  const active = hasActiveTransactionImport(items);
  const financialState = financialEvent?.workflow?.state;

  const refresh = useCallback(async () => {
    if (!emailUid) {
      return;
    }
    const requestId = ++requestRef.current;
    try {
      const response = await getTransactionImportEmailStatus(emailUid);
      if (mountedRef.current && requestId === requestRef.current) {
        setResult({ emailUid, items: response.items, financialEvent: response.financialEvent || null, error: false });
      }
    } catch {
      if (mountedRef.current && requestId === requestRef.current) {
        setResult((current) => current.emailUid === emailUid ? { ...current, error: true }
          : { emailUid, items: [], financialEvent: null, error: true });
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
            setResult({ emailUid, items: response.items, financialEvent: response.financialEvent || null, error: false });
          }
        })
        .catch(() => {
          if (mountedRef.current && requestId === requestRef.current) {
            setResult((current) => current.emailUid === emailUid ? { ...current, error: true }
              : { emailUid, items: [], financialEvent: null, error: true });
          }
        });
    }
    return () => {
      mountedRef.current = false;
    };
  }, [emailUid]);

  useEffect(() => {
    const onFinancialChange = (event: Event) => {
      const detail = (event as CustomEvent<{ emailUid: string; plan?: FinancialEmailPlan }>).detail;
      if (detail?.emailUid && detail.emailUid !== emailUid) return;
      if (detail?.plan) {
        ++requestRef.current;
        setResult((current) => ({ emailUid, items: current.emailUid === emailUid ? current.items : [], financialEvent: detail.plan!, error: false }));
      } else void refresh();
    };
    window.addEventListener("ea-financial-event-changed", onFinancialChange);
    return () => window.removeEventListener("ea-financial-event-changed", onFinancialChange);
  }, [emailUid, refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (!pollAllStates && !active && !["pending", "waiting"].includes(financialState || "")) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, !active && financialState !== "pending" ? 30_000 : 3_000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, financialState, pollAllStates, refresh]);

  return { items, financialEvent, error, loading: !emailUid || result.emailUid !== emailUid, refresh };
}
