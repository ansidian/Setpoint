import { useState, useEffect, lazy, Suspense } from "react";
import type { ReactElement } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router";
import { checkAuth, prefetchCurrentDashboard } from "./api";
import { getOnboardingProgress } from "./lib/onboardingApi";
import { getSetupStatus } from "./setupApi";
import { isDemoMode } from "./demo/config.ts";
import { resolveRouterBasename } from "./routerBase";
import {
  applyOnboardingStatusChange,
  initialAppBootstrap,
  isSettingsShortcut,
  resolveAppRedirect,
  type AppBootstrapState,
  type AppRoutePath,
} from "./appRouteModel";
import MouseSpotlightCanvas from "./components/layout/MouseSpotlightCanvas";
import ChunkLoadBoundary from "./components/layout/ChunkLoadBoundary";
import RecoverableErrorBoundary from "./components/layout/RecoverableErrorBoundary";
// Single import factory so we can both lazy-mount the Dashboard and warm its
// chunk during the auth round trip — the bundler dedupes to one module fetch.
const importDashboard = () => import("./pages/Dashboard");
const Dashboard = lazy(importDashboard);
const Login = lazy(() => import("./pages/Login"));
const OwnerSetup = lazy(() => import("./pages/OwnerSetup"));
const SettingsRoute = lazy(() => import("./pages/SettingsRoute"));
const Onboarding = lazy(() => import("./pages/Onboarding"));

function AuthSpinner(): ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-white/10 border-t-accent-light rounded-full animate-spin" />
    </div>
  );
}

type SettingsShortcutProps = { enabled: boolean };

function redirectElement(path: AppRoutePath, bootstrap: AppBootstrapState, content: ReactElement): ReactElement {
  const destination = resolveAppRedirect(path, bootstrap);
  return destination ? <Navigate to={destination} replace /> : content;
}

function SettingsShortcut({ enabled }: SettingsShortcutProps): null {
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (!isSettingsShortcut(event)) return;

      event.preventDefault();
      navigate("/settings");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, navigate]);

  return null;
}

export default function App(): ReactElement {
  const demoMode = isDemoMode();
  const [bootstrap, setBootstrap] = useState<AppBootstrapState | null>(() => initialAppBootstrap(demoMode));

  useEffect(() => {
    if (demoMode) return undefined;

    getSetupStatus()
      .then(async (status) => {
        if (!status.claimed) {
          setBootstrap({ claimed: false, authenticated: false, onboardingFinished: false });
          return;
        }
        importDashboard().catch(() => {});
        const auth = await checkAuth();
        const onboardingFinished = auth.authenticated
          ? (await getOnboardingProgress().catch(() => ({ status: "complete" as const }))).status === "complete"
          : true;
        setBootstrap({ claimed: true, authenticated: auth.authenticated, onboardingFinished });
        if (auth.authenticated) prefetchCurrentDashboard();
      })
      .catch(() => setBootstrap({ claimed: true, authenticated: false, onboardingFinished: true }));
  }, [demoMode]);

  useEffect(() => {
    function handleOnboardingChanged(event: Event) {
      const finished = (event as CustomEvent<{ finished?: unknown }>).detail?.finished;
      setBootstrap((current) => applyOnboardingStatusChange(current, finished));
    }
    window.addEventListener("ea-onboarding-changed", handleOnboardingChanged);
    return () => window.removeEventListener("ea-onboarding-changed", handleOnboardingChanged);
  }, []);

  if (bootstrap === null) {
    return <AuthSpinner />;
  }

  const { authenticated } = bootstrap;

  return (
    <ChunkLoadBoundary>
      <MouseSpotlightCanvas />
      <BrowserRouter basename={resolveRouterBasename()}>
        <SettingsShortcut enabled={authenticated === true} />
        <Routes>
          <Route path="/setup" element={
            redirectElement("/setup", bootstrap, (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <OwnerSetup onClaimed={() => setBootstrap({ claimed: true, authenticated: true, onboardingFinished: false })} />
                </Suspense>
              </RecoverableErrorBoundary>
            ))
          } />
          <Route path="/login" element={
            redirectElement("/login", bootstrap, (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <Login onLogin={() => {
                    void getOnboardingProgress()
                      .then((progress) => setBootstrap({ claimed: true, authenticated: true, onboardingFinished: progress.status === "complete" }))
                      .catch(() => setBootstrap({ claimed: true, authenticated: true, onboardingFinished: true }));
                  }} />
                </Suspense>
              </RecoverableErrorBoundary>
            ))
          } />
          <Route path="/" element={
            redirectElement("/", bootstrap, (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <Dashboard />
                </Suspense>
              </RecoverableErrorBoundary>
            ))
          } />
          <Route path="/settings" element={
            redirectElement("/settings", bootstrap, (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <SettingsRoute />
                </Suspense>
              </RecoverableErrorBoundary>
            ))
          } />
          <Route path="/onboarding" element={
            redirectElement("/onboarding", bootstrap, (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <Onboarding />
                </Suspense>
              </RecoverableErrorBoundary>
            ))
          } />
        </Routes>
      </BrowserRouter>
    </ChunkLoadBoundary>
  );
}
