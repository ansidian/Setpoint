import { useState } from "react";
import { Bell } from "lucide-react";
import { isDemoMode } from "../../../../demo/config";
import { Button } from "../../../ui/button";
import { SettingsCard, StatusPill } from "../../settings-ui";

export default function FinancialReviewNotificationsControl() {
  const available = !isDemoMode() && typeof Notification !== "undefined";
  const [permission, setPermission] = useState(available ? Notification.permission : "denied");
  if (!available) return null;
  return <SettingsCard title="Browser alerts" icon={<Bell size={14} />} description="Get an alert when a financial record needs attention while Setpoint is open."
    headerAction={<StatusPill tone={permission === "granted" ? "success" : permission === "denied" ? "warning" : "neutral"}>{permission === "granted" ? "On" : permission === "denied" ? "Blocked" : "Off"}</StatusPill>}>
    <div className="flex flex-wrap items-center gap-3 text-xs leading-relaxed text-muted-foreground">
    {permission === "granted" ? <p>You’ll be notified when a record needs your review.</p>
      : permission === "denied" ? <p>Allow notifications in your browser’s site settings to receive alerts.</p> : null}
    {permission === "default" && <Button type="button" variant="ghost" size="sm"
      className="min-h-9 max-[600px]:min-h-11 transition-[background-color,color,transform,box-shadow] duration-[160ms] hover:-translate-y-px focus-visible:-translate-y-px active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
      onClick={() => { void Notification.requestPermission().then((value) => {
        setPermission(value);
        window.dispatchEvent(new CustomEvent("ea-financial-event-changed"));
      }).catch(() => {}); }}>Enable browser alerts</Button>}
    </div>
  </SettingsCard>;
}
