import { lazy, Suspense } from "react";
import SettingsChrome from "../components/settings/SettingsChrome";

const Settings = lazy(() => import("./Settings"));

export default function SettingsRoute() {
  return (
    <Suspense fallback={<SettingsChrome />}>
      <Settings />
    </Suspense>
  );
}
