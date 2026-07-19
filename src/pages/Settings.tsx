import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import ConnectionsSettingsSection from "@/components/settings/sections/ConnectionsSettingsSection";
import ActualBudgetSettingsSection from "@/components/settings/sections/ActualBudgetSettingsSection";
import EmailAutomationSettingsSection from "@/components/settings/sections/EmailAutomationSettingsSection";
import SystemSettingsSection from "@/components/settings/sections/SystemSettingsSection";
import {
  SaveStatus,
  SettingsLayout,
  SkeletonCard,
} from "@/components/settings/settings-ui";
import useSettingsPage from "@/hooks/settings/useSettingsPage";

export default function Settings() {
  const location = useLocation();
  const {
    accounts,
    setAccounts,
    settings,
    connectionGroups,
    connections,
    credentialMetadata,
    refreshInstanceCredentials,
    updateInstanceCredentialMetadata,
    setSettings,
    loading,
    tab,
    setTab,
    saveStatus,
    patch,
  } = useSettingsPage();

  useEffect(() => {
    if (loading || !location.hash) return;
    const targetId = location.hash.slice(1);
    let target: HTMLElement | null = null;
    let settleTimer: number | null = null;
    let scrollFallbackTimer: number | null = null;
    let flashTimer: number | null = null;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    let scrollFinished = false;

    function clearScrollWait() {
      window.removeEventListener("scrollend", finishScroll);
      document.removeEventListener("scrollend", finishScroll);
      if (scrollFallbackTimer !== null) window.clearTimeout(scrollFallbackTimer);
      scrollFallbackTimer = null;
    }

    function flashTarget() {
      if (!target) return;
      target.dataset.settingsTargetActive = "true";
      flashTimer = window.setTimeout(() => {
        if (target) delete target.dataset.settingsTargetActive;
      }, 1600);
    }

    function finishScroll() {
      if (scrollFinished) return;
      scrollFinished = true;
      clearScrollWait();
      flashTarget();
    }

    function scrollToReadyTarget() {
      if (!target) return;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      if (!reduceMotion) {
        window.addEventListener("scrollend", finishScroll, { once: true });
        document.addEventListener("scrollend", finishScroll, { once: true });
      }
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      target.focus({ preventScroll: true });
      if (reduceMotion) finishScroll();
      else scrollFallbackTimer = window.setTimeout(finishScroll, 700);
    }

    const observer = new MutationObserver(() => scheduleReadyTarget());

    function scheduleReadyTarget() {
      const candidate = document.getElementById(targetId);
      const panel = candidate?.closest('[role="tabpanel"]');
      const sections = panel
        ? Array.from(panel.querySelectorAll<HTMLElement>('[data-settings-section]'))
        : [];
      const targetIndex = candidate ? sections.indexOf(candidate) : -1;
      const busyBeforeTarget = targetIndex >= 0 && sections
        .slice(0, targetIndex + 1)
        .some((section) => section.dataset.settingsTargetReady === "false" || section.getAttribute("aria-busy") === "true");
      const loadingBeforeTarget = candidate && panel
        ? Array.from(panel.querySelectorAll<HTMLElement>('[data-settings-content-loading]')).some((placeholder) =>
          Boolean(placeholder.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
        )
        : false;
      const ready = candidate
        && candidate.dataset.settingsTargetReady !== "false"
        && candidate.getAttribute("aria-busy") !== "true"
        && !busyBeforeTarget
        && !loadingBeforeTarget;
      if (!ready) {
        if (settleTimer !== null) window.clearTimeout(settleTimer);
        settleTimer = null;
        return;
      }

      target = candidate;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        observer.disconnect();
        firstFrame = window.requestAnimationFrame(() => {
          secondFrame = window.requestAnimationFrame(scrollToReadyTarget);
        });
      }, 140);
    }

    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    scheduleReadyTarget();

    return () => {
      observer.disconnect();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      if (flashTimer !== null) window.clearTimeout(flashTimer);
      clearScrollWait();
      if (target) delete target.dataset.settingsTargetActive;
    };
  }, [loading, location.hash, tab]);

  let content = (
    <>
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
    </>
  );

  if (!loading) {
    if (tab === "connections") {
      content = (
        <ConnectionsSettingsSection
          accounts={accounts}
          setAccounts={setAccounts}
          settings={settings}
          patch={patch}
          connectionGroups={connectionGroups}
          connections={connections}
          credentialMetadata={credentialMetadata}
          onCredentialMetadataChange={updateInstanceCredentialMetadata}
          onRefreshCredentialMetadata={refreshInstanceCredentials}
        />
      );
    } else if (tab === "finance") {
      content = (
        <ActualBudgetSettingsSection
          settings={settings}
          setSettings={setSettings}
          patch={patch}
          connections={connections}
        />
      );
    } else if (tab === "automation") {
      content = (
        <EmailAutomationSettingsSection
          settings={settings}
          setSettings={setSettings}
          patch={patch}
          connections={connections}
        />
      );
    } else {
      content = <SystemSettingsSection />;
    }
  }

  return (
    <SettingsLayout
      activeTab={tab}
      onTabChange={setTab}
      headerAction={<SaveStatus status={saveStatus} />}
    >
      {content}
    </SettingsLayout>
  );
}
