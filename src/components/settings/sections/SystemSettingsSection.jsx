import ApiTokensCard from "@/components/settings/cards/ApiTokensCard";
import BillExtractionAiCard from "@/components/settings/cards/BillExtractionAiCard";

export default function SystemSettingsSection({ settings, setSettings, patch }) {
  return (
    <>
      <BillExtractionAiCard settings={settings} setSettings={setSettings} patch={patch} />
      <ApiTokensCard />
    </>
  );
}
