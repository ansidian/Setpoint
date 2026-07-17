import { lazy, Suspense } from "react";
import type { ReactElement } from "react";
import SettingsChrome from "../components/settings/SettingsChrome";

const Settings = lazy(() => import("./Settings"));

export default function SettingsRoute(): ReactElement {
  return (
    <Suspense fallback={<SettingsChrome />}>
      <Settings />
    </Suspense>
  );
}
