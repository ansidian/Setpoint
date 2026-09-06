import { useEffect } from "react";
import { useNavigate } from "react-router";
import { createFinancialReviewNotifications } from "../lib/financialReviewNotifications";

export default function useFinancialReviewNotifications(enabled: boolean) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return;
    const controller = createFinancialReviewNotifications(navigate);
    const refresh = () => { void controller.refresh(); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("ea-financial-event-changed", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.dispose();
      window.clearInterval(timer);
      window.removeEventListener("ea-financial-event-changed", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, navigate]);
}
