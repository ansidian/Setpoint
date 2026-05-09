import { useCallback, useEffect, useRef, useState } from "react";
import { getActualMetadata } from "@/api";
import ActualBudgetConnectionCard from "@/components/settings/cards/ActualBudgetConnectionCard";
import BillPayMappingsCard from "@/components/settings/cards/BillPayMappingsCard";
import BillPayMappingTestCard from "@/components/settings/cards/BillPayMappingTestCard";

const EMPTY_METADATA = { accounts: [], payees: [], categories: [] };

export default function ActualBudgetSettingsSection({ settings, setSettings, patch }) {
  const [metadata, setMetadata] = useState(EMPTY_METADATA);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState("");
  const mountedRef = useRef(true);
  const metadataPromiseRef = useRef(null);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const requestMetadata = useCallback(() => {
    if (metadataPromiseRef.current) return metadataPromiseRef.current;
    setMetadataLoading(true);
    setMetadataError("");
    const promise = getActualMetadata()
      .then((result) => {
        if (mountedRef.current) setMetadata(result || EMPTY_METADATA);
        return result || EMPTY_METADATA;
      })
      .catch((error) => {
        metadataPromiseRef.current = null;
        if (mountedRef.current) setMetadata(EMPTY_METADATA);
        if (mountedRef.current) setMetadataError(error?.message || "Actual metadata unavailable");
        return EMPTY_METADATA;
      })
      .finally(() => {
        if (mountedRef.current) setMetadataLoading(false);
      });
    metadataPromiseRef.current = promise;
    return promise;
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
        metadataError={metadataError}
        onRequestMetadata={requestMetadata}
      />
      <BillPayMappingTestCard settings={settings} />
    </>
  );
}
