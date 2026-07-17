import { useState, useEffect, lazy, Suspense } from "react";
import type { ReactElement } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { checkAuth, prefetchCurrentDashboard } from "./api";
import { getSetupStatus } from "./setupApi";
import { isDemoMode } from "./demo/config.ts";
import { resolveRouterBasename } from "./routerBase";
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

function AuthSpinner(): ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-white/10 border-t-accent-light rounded-full animate-spin" />
    </div>
  );
}

type SettingsShortcutProps = { enabled: boolean };

function SettingsShortcut({ enabled }: SettingsShortcutProps): null {
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key !== ",") return;

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
  const [bootstrap, setBootstrap] = useState<{ claimed: boolean; authenticated: boolean } | null>(
    demoMode ? { claimed: true, authenticated: true } : null,
  );

  useEffect(() => {
    if (demoMode) return undefined;

    getSetupStatus()
      .then(async (status) => {
        if (!status.claimed) {
          setBootstrap({ claimed: false, authenticated: false });
          return;
        }
        importDashboard().catch(() => {});
        const auth = await checkAuth();
        setBootstrap({ claimed: true, authenticated: auth.authenticated });
        if (auth.authenticated) prefetchCurrentDashboard();
      })
      .catch(() => setBootstrap({ claimed: true, authenticated: false }));
  }, [demoMode]);

  if (bootstrap === null) {
    return <AuthSpinner />;
  }

  const { claimed, authenticated } = bootstrap;

  return (
    <ChunkLoadBoundary>
      <MouseSpotlightCanvas />
      <BrowserRouter basename={resolveRouterBasename()}>
        <SettingsShortcut enabled={authenticated === true} />
        <Routes>
          <Route path="/setup" element={
            claimed ? <Navigate to="/" replace /> : (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <OwnerSetup onClaimed={() => setBootstrap({ claimed: true, authenticated: true })} />
                </Suspense>
              </RecoverableErrorBoundary>
            )
          } />
          <Route path="/login" element={
            !claimed ? <Navigate to="/setup" replace /> : authenticated ? <Navigate to="/" replace /> : (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <Login onLogin={() => setBootstrap({ claimed: true, authenticated: true })} />
                </Suspense>
              </RecoverableErrorBoundary>
            )
          } />
          <Route path="/" element={
            !claimed ? <Navigate to="/setup" replace /> : authenticated ? (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <Dashboard />
                </Suspense>
              </RecoverableErrorBoundary>
            ) : <Navigate to="/login" replace />
          } />
          <Route path="/settings" element={
            !claimed ? <Navigate to="/setup" replace /> : authenticated ? (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <SettingsRoute />
                </Suspense>
              </RecoverableErrorBoundary>
            ) : <Navigate to="/login" replace />
          } />
        </Routes>
      </BrowserRouter>
    </ChunkLoadBoundary>
  );
}
