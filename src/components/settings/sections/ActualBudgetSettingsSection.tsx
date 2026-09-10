import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { getActualMetadata } from "@/api";
import UtilityMappingsCard from "../cards/UtilityMappingsCard";
import UtilityPayLinksCard from "@/components/settings/cards/UtilityPayLinksCard";
import FinancialProfilesCard from "@/components/settings/cards/FinancialProfilesCard";
import { profileDraftFromRouteState } from "../cards/financialProfileModel";
import { financialProfileSeedFromRouteState } from "@/lib/financialProfileSeed";
import FinancialReviewNotificationsControl from "../cards/financial-review/FinancialReviewNotificationsControl";
import ConnectionDependencyPrompt from "@/components/settings/ConnectionDependencyPrompt";
import { projectFeatureDependencies } from "@/components/settings/featureDependencyModel";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { ConnectionRowView } from "../connectionModel";
import type { ActualMetadataResponse } from "../../../../shared/types/bills";

const EMPTY_METADATA: ActualMetadataResponse = { accounts: [], payees: [], categories: [] };

export default function ActualBudgetSettingsSection({
  settings,
  setSettings,
  patch,
  connections,
}: SettingsCardStateProps & { connections: readonly ConnectionRowView[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [initialDraft] = useState(() => profileDraftFromRouteState(location.state) || financialProfileSeedFromRouteState(location.state));
  const dependency = projectFeatureDependencies(connections).finance;
  const budgetId = settings?.actual_budget_sync_id || "";
  const liveMetadataAvailable = dependency.allowLiveMetadata && !!budgetId;
  const context = `${budgetId}:${liveMetadataAvailable}`;
  const [metadataContext, setMetadataContext] = useState("");
  const [loadedMetadata, setMetadata] = useState<ActualMetadataResponse>(EMPTY_METADATA);
  const [loading, setMetadataLoading] = useState(false);
  const [error, setMetadataError] = useState("");
  const metadata = metadataContext === context ? loadedMetadata : EMPTY_METADATA;
  const metadataLoading = liveMetadataAvailable && (metadataContext !== context || loading);
  const metadataError = metadataContext === context ? error : "";
  const mountedRef = useRef(true);
  const metadataPromiseRef = useRef<{ context: string; promise: Promise<ActualMetadataResponse> } | null>(null);

  useEffect(() => {
    if (!initialDraft || !(location.state?.financialProfileDraft || location.state?.financialProfileSeed)) return;
    const remainingState = { ...location.state };
    delete remainingState.financialProfileDraft;
    delete remainingState.financialProfileSeed;
    // Consume navigation intent, not settings: Cancel/back must not resurrect a draft.
    void navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: remainingState });
  }, [initialDraft, location, navigate]);

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
    if (!liveMetadataAvailable) {
      metadataPromiseRef.current = null;
      return Promise.resolve(EMPTY_METADATA);
    }
    if (metadataPromiseRef.current?.context === context) return metadataPromiseRef.current.promise;
    setMetadataContext(context);
    setMetadata(EMPTY_METADATA);
    setMetadataLoading(true);
    setMetadataError("");
    const promise = getActualMetadata()
      .then((result) => {
        if (mountedRef.current && metadataPromiseRef.current?.promise === promise) setMetadata(result || EMPTY_METADATA);
        return result || EMPTY_METADATA;
      })
      .catch((error) => {
        if (mountedRef.current && metadataPromiseRef.current?.promise === promise) {
          setMetadata(EMPTY_METADATA);
          setMetadataError(error instanceof Error ? error.message : "Actual metadata unavailable");
          setMetadataLoading(false);
          metadataPromiseRef.current = null;
        }
        return EMPTY_METADATA;
      })
      .finally(() => {
        if (mountedRef.current && metadataPromiseRef.current?.promise === promise) setMetadataLoading(false);
      });
    metadataPromiseRef.current = { context, promise };
    return promise;
  }, [context, liveMetadataAvailable]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialize this budget's loading state before its deduplicated provider read; failures require an explicit retry
    void requestMetadata();
  }, [requestMetadata]);

  if (!dependency.showSettings) {
    return (
      <>
        <FinancialReviewNotificationsControl />
        <ConnectionDependencyPrompt
          title="Connect Actual Budget"
          description="Finance tools become available after Actual Budget is connected. Existing profiles and pay links remain saved while disconnected."
          actions={[{ connectionId: "actual-budget", label: "Set up Actual Budget" }]}
        />
        <UtilityMappingsCard key={budgetId} budgetId={budgetId} available={liveMetadataAvailable} settings={settings} setSettings={setSettings} patch={patch}/>
        <FinancialProfilesCard
          initialDraft={initialDraft}
          settings={settings}
          setSettings={setSettings}
          patch={patch}
          metadata={metadata}
          metadataLoading={metadataLoading}
          metadataError={metadataError}
          onRequestMetadata={requestMetadata}
          liveMetadataAvailable={liveMetadataAvailable}
        />
      </>
    );
  }

  return (
    <>
      <FinancialReviewNotificationsControl />
      {dependency.actual === "needs_attention" ? (
        <ConnectionDependencyPrompt
          title="Actual Budget needs attention"
          description="Profiles and pay links stay available for review. Repair the connection to refresh Actual accounts, payees, categories, and schedules."
          attention
          actions={[{ connectionId: "actual-budget", label: "Repair connection" }]}
        />
      ) : null}
      <FinancialProfilesCard
        initialDraft={initialDraft}
        settings={settings}
        setSettings={setSettings}
        patch={patch}
        metadata={metadata}
        metadataLoading={metadataLoading}
        metadataError={metadataError}
        onRequestMetadata={requestMetadata}
        liveMetadataAvailable={liveMetadataAvailable}
      />
      <UtilityMappingsCard key={budgetId} budgetId={budgetId} available={liveMetadataAvailable} settings={settings} setSettings={setSettings} patch={patch}>
      {mappedScheduleIds => <UtilityPayLinksCard
        mappedScheduleIds={mappedScheduleIds}
        settings={settings}
        setSettings={setSettings}
        patch={patch}
        metadata={metadata}
        metadataLoading={metadataLoading}
        metadataError={metadataError}
        onRequestMetadata={requestMetadata}
        liveMetadataAvailable={liveMetadataAvailable}
      />}
      </UtilityMappingsCard>
    </>
  );
}
