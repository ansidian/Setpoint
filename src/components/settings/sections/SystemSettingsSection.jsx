import ApiTokensCard from "@/components/settings/cards/ApiTokensCard";
import BillExtractionAiCard from "@/components/settings/cards/BillExtractionAiCard";
import EmailTriageModeCard from "@/components/settings/cards/EmailTriageModeCard";

export default function SystemSettingsSection({ settings, setSettings, patch }) {
  return (
    <>
      <BillExtractionAiCard settings={settings} setSettings={setSettings} patch={patch} />
      <EmailTriageModeCard settings={settings} setSettings={setSettings} patch={patch} />
      <ApiTokensCard />
    </>
  );
}
