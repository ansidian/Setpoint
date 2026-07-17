import {
  SaveStatus,
  SettingsLayout,
  SkeletonCard,
} from "@/components/settings/settings-ui";
import { readTabFromURL } from "@/components/settings/settings-core";

export default function SettingsChrome() {
  return (
    <SettingsLayout
      activeTab={readTabFromURL()}
      headerAction={<SaveStatus status="idle" />}
    >
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
    </SettingsLayout>
  );
}
