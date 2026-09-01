import { useCallback, useEffect, useRef, useState } from "react";
import { getActualMetadata } from "@/api";
import UtilityPayLinksCard from "@/components/settings/cards/UtilityPayLinksCard";
import EmailTransactionImportCard from "@/components/settings/cards/EmailTransactionImportCard";
import ConnectionDependencyPrompt from "@/components/settings/ConnectionDependencyPrompt";
import { projectFeatureDependencies } from "@/components/settings/featureDependencyModel";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { ConnectionRowView } from "../connectionModel";
import type { ActualMetadataResponse } from "../../../../shared/types/bills";
import type { AccountSummary } from "../../../../shared/types/accounts";

const EMPTY_METADATA: ActualMetadataResponse = { accounts: [], payees: [], categories: [] };

export default function ActualBudgetSettingsSection({
  settings,
  setSettings,
  patch,
  connections,
  accounts,
}: SettingsCardStateProps & { connections: readonly ConnectionRowView[]; accounts: AccountSummary[] }) {
  const dependency = projectFeatureDependencies(connections).finance;
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
    if (!dependency.allowLiveMetadata) return Promise.resolve(EMPTY_METADATA);
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
  }, [dependency.allowLiveMetadata]);

  if (!dependency.showSettings) {
    return (
      <ConnectionDependencyPrompt
        title="Connect Actual Budget"
        description="Finance tools become available after Actual Budget is connected. Existing pay links remain saved while disconnected."
        actions={[{ connectionId: "actual-budget", label: "Set up Actual Budget" }]}
      />
    );
  }

  return (
    <>
      {dependency.actual === "needs_attention" ? (
        <ConnectionDependencyPrompt
          title="Actual Budget needs attention"
          description="Pay links stay available for review. Repair the connection to refresh Actual accounts, payees, categories, and schedules."
          attention
          actions={[{ connectionId: "actual-budget", label: "Repair connection" }]}
        />
      ) : null}
      <EmailTransactionImportCard
        metadata={metadata}
        metadataLoading={metadataLoading}
        onRequestMetadata={requestMetadata}
        gmailAccounts={accounts}
        liveOperationsAvailable={dependency.allowLiveMetadata}
      />
      <UtilityPayLinksCard
        settings={settings}
        setSettings={setSettings}
        patch={patch}
        metadata={metadata}
        metadataLoading={metadataLoading}
        metadataError={metadataError}
        onRequestMetadata={requestMetadata}
        liveMetadataAvailable={dependency.allowLiveMetadata}
      />
    </>
  );
}
