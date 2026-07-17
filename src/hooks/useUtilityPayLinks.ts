import { useEffect, useState } from "react";
import { getSettings } from "@/api";

export type UtilityPayLinksByScheduleId = Record<string, string>;

// Pure: settings.utility_pay_links -> { [scheduleId]: url }, dropping incomplete
// rows. Exported separately so it can be unit-tested without rendering.
export function buildPayLinksByScheduleId(utilityPayLinks: unknown): UtilityPayLinksByScheduleId {
  const map: UtilityPayLinksByScheduleId = {};
  const list = Array.isArray(utilityPayLinks) ? utilityPayLinks : [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { scheduleId, url } = entry as Record<string, unknown>;
    if (typeof scheduleId === "string" && scheduleId && typeof url === "string" && url) {
      map[scheduleId] = url;
    }
  }
  return map;
}

// Fetches settings once and rebuilds on the "ea-settings-changed" event the
// settings page fires after a successful save (mirrors useTriageNotificationSounds).
export function useUtilityPayLinks(): UtilityPayLinksByScheduleId {
  const [payLinksByScheduleId, setPayLinksByScheduleId] = useState<UtilityPayLinksByScheduleId>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const settings = await getSettings();
        if (!cancelled) setPayLinksByScheduleId(buildPayLinksByScheduleId(settings?.utility_pay_links));
      } catch {
        if (!cancelled) setPayLinksByScheduleId({});
      }
    };
    load();
    const onChanged = () => { load(); };
    window.addEventListener("ea-settings-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("ea-settings-changed", onChanged);
    };
  }, []);

  return payLinksByScheduleId;
}
