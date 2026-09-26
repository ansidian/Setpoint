import { useState } from "react";
import { isDemoMode } from "../../demo/config";

const STORAGE_KEY = "inbox:focusUnread";
let remembered = false;
let demoRemembered = false;

export default function useInboxFocusUnread() {
  const [focusUnread, setValue] = useState(() => {
    if (isDemoMode()) return demoRemembered;
    try { return window.localStorage.getItem(STORAGE_KEY) === "true"; }
    catch { return remembered; }
  });
  const setFocusUnread = (value: boolean) => {
    setValue(value);
    if (isDemoMode()) { demoRemembered = value; return; }
    remembered = value;
    try { window.localStorage.setItem(STORAGE_KEY, String(value)); }
    catch { /* Preserve the choice in memory when storage is unavailable. */ }
  };
  return { focusUnread, setFocusUnread };
}
