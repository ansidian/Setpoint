import { useState, useEffect, lazy, Suspense } from "react";
import type { ReactElement } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { checkAuth, prefetchCurrentDashboard } from "./api";
import { isDemoMode } from "./demo/config.js";
import { resolveRouterBasename } from "./routerBase";
import MouseSpotlightCanvas from "./components/layout/MouseSpotlightCanvas";
import ChunkLoadBoundary from "./components/layout/ChunkLoadBoundary";
import RecoverableErrorBoundary from "./components/layout/RecoverableErrorBoundary";
// Single import factory so we can both lazy-mount the Dashboard and warm its
// chunk during the auth round trip — the bundler dedupes to one module fetch.
const importDashboard = () => import("./pages/Dashboard");
const Dashboard = lazy(importDashboard);
const Login = lazy(() => import("./pages/Login"));
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
  const [authenticated, setAuthenticated] = useState<boolean | null>(demoMode ? true : null); // null = loading

  useEffect(() => {
    if (demoMode) return undefined;

    // Warm the Dashboard chunk in parallel with the auth round trip so its fetch
    // is no longer serialized behind checkAuth → Suspense mount. Correctness is
    // unchanged: the gate below still renders Dashboard only when authenticated;
    // this only overlaps the (otherwise wasted) waterfall. Swallow rejections so
    // a prefetch failure never surfaces — the real lazy() mount handles errors.
    importDashboard().catch(() => {});

    checkAuth()
      .then((res) => {
        setAuthenticated(res.authenticated);
        // Auth-gated data prefetch: warm /api/dashboard/current only once auth is
        // confirmed, so it never fires on an unauthenticated session (which would
        // 401-redirect). Primes the same single-use cache the Dashboard mount fetch
        // consumes, so it overlaps the chunk load instead of double-fetching.
        if (res.authenticated) prefetchCurrentDashboard();
      })
      .catch(() => setAuthenticated(false));
  }, [demoMode]);

  if (authenticated === null) {
    return <AuthSpinner />;
  }

  return (
    <ChunkLoadBoundary>
      <MouseSpotlightCanvas />
      <BrowserRouter basename={resolveRouterBasename()}>
        <SettingsShortcut enabled={authenticated === true} />
        <Routes>
          <Route path="/login" element={
            authenticated ? <Navigate to="/" replace /> : (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <Login onLogin={() => setAuthenticated(true)} />
                </Suspense>
              </RecoverableErrorBoundary>
            )
          } />
          <Route path="/" element={
            authenticated ? (
              <RecoverableErrorBoundary>
                <Suspense fallback={<AuthSpinner />}>
                  <Dashboard />
                </Suspense>
              </RecoverableErrorBoundary>
            ) : <Navigate to="/login" replace />
          } />
          <Route path="/settings" element={
            authenticated ? (
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
