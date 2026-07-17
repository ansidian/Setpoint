import { useCallback, useEffect, useRef, useState } from "react";
import { getActualMetadata } from "@/api";
import ActualBudgetConnectionCard from "@/components/settings/cards/ActualBudgetConnectionCard";
import BillPayMappingsCard from "@/components/settings/cards/BillPayMappingsCard";
import BillPayMappingTestCard from "@/components/settings/cards/BillPayMappingTestCard";
import UtilityPayLinksCard from "@/components/settings/cards/UtilityPayLinksCard";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { ActualMetadataResponse } from "../../../../shared/types/bills";

const EMPTY_METADATA: ActualMetadataResponse = { accounts: [], payees: [], categories: [] };

export default function ActualBudgetSettingsSection({ settings, setSettings, patch }: SettingsCardStateProps) {
  const [metadata, setMetadata] = useState<ActualMetadataResponse>(EMPTY_METADATA);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState("");
  const mountedRef = useRef(true);
  const metadataPromiseRef = useRef<Promise<ActualMetadataResponse> | null>(null);

  // Set true on (re)mount, not just false on cleanup: under StrictMode the
  // mount → cleanup → remount cycle would otherwise leave the ref permanently
  // false, silently dropping every metadata state update (stuck "Loading…").
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
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
        if (mountedRef.current) setMetadataError(error instanceof Error ? error.message : "Actual metadata unavailable");
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
      <UtilityPayLinksCard
        settings={settings}
        setSettings={setSettings}
        patch={patch}
        metadata={metadata}
        metadataLoading={metadataLoading}
        metadataError={metadataError}
        onRequestMetadata={requestMetadata}
      />
    </>
  );
}
