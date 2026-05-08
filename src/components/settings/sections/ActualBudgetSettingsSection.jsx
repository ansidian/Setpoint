import { useEffect, useState } from "react";
import { getActualMetadata } from "@/api";
import ActualBudgetConnectionCard from "@/components/settings/cards/ActualBudgetConnectionCard";
import BillPayMappingsCard from "@/components/settings/cards/BillPayMappingsCard";

const EMPTY_METADATA = { accounts: [], payees: [], categories: [] };

export default function ActualBudgetSettingsSection({ settings, setSettings, patch }) {
  const [metadata, setMetadata] = useState(EMPTY_METADATA);
  const [metadataLoading, setMetadataLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getActualMetadata()
      .then((result) => {
        if (!cancelled) setMetadata(result || EMPTY_METADATA);
      })
      .catch(() => {
        if (!cancelled) setMetadata(EMPTY_METADATA);
      })
      .finally(() => {
        if (!cancelled) setMetadataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <ActualBudgetConnectionCard settings={settings} />
      <BillPayMappingsCard
        settings={settings}
        setSettings={setSettings}
        patch={patch}
        metadata={metadata}
        metadataLoading={metadataLoading}
      />
    </>
  );
}
