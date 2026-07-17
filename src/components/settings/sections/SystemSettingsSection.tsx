import ApiTokensCard from "@/components/settings/cards/ApiTokensCard";
import PasskeysCard from "@/components/settings/cards/PasskeysCard";
import CanonicalDomainCard from "@/components/settings/cards/CanonicalDomainCard";

export default function SystemSettingsSection() {
  return (
    <>
      <PasskeysCard />
      <CanonicalDomainCard />
      <ApiTokensCard />
    </>
  );
}
