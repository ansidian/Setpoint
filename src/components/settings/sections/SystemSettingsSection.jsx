import ApiTokensCard from "@/components/settings/cards/ApiTokensCard";
import PasskeysCard from "@/components/settings/cards/PasskeysCard";

export default function SystemSettingsSection() {
  return (
    <>
      <PasskeysCard />
      <ApiTokensCard />
    </>
  );
}
