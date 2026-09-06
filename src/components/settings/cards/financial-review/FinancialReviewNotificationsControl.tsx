import { useState } from "react";
import { isDemoMode } from "../../../../demo/config";
import { Button } from "../../../ui/button";

export default function FinancialReviewNotificationsControl() {
  const available = !isDemoMode() && typeof Notification !== "undefined";
  const [permission, setPermission] = useState(available ? Notification.permission : "denied");
  if (!available) return null;
  return <div className="mb-4 flex flex-wrap items-center gap-2 text-xs leading-relaxed text-muted-foreground">
    <span>{permission === "granted" ? "Browser alerts are on while Setpoint is open. Unchanged automatic retries stay quiet."
      : permission === "denied" ? "Browser alerts are blocked. You can allow notifications in your browser’s site settings; this queue stays available."
        : "Get a browser alert when a financial record needs your attention while Setpoint is open."}</span>
    {permission === "default" && <Button type="button" variant="ghost" size="sm"
      className="hover:-translate-y-px focus-visible:-translate-y-px active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
      onClick={() => { void Notification.requestPermission().then((value) => {
        setPermission(value);
        window.dispatchEvent(new CustomEvent("ea-financial-event-changed"));
      }).catch(() => {}); }}>Enable browser alerts</Button>}
  </div>;
}
