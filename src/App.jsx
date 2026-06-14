import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { checkAuth } from "./api";
import { isDemoMode } from "./demo/config.js";
import { resolveRouterBasename } from "./routerBase.js";
import MouseSpotlightCanvas from "./components/layout/MouseSpotlightCanvas";
import ChunkLoadBoundary from "./components/layout/ChunkLoadBoundary";
import RecoverableErrorBoundary from "./components/layout/RecoverableErrorBoundary";
// Single import factory so we can both lazy-mount the Dashboard and warm its
// chunk during the auth round trip — the bundler dedupes to one module fetch.
const importDashboard = () => import("./pages/Dashboard");
const Dashboard = lazy(importDashboard);
const Login = lazy(() => import("./pages/Login"));
const SettingsRoute = lazy(() => import("./pages/SettingsRoute"));

function AuthSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-white/10 border-t-accent-light rounded-full animate-spin" />
    </div>
  );
}

function SettingsShortcut({ enabled }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return undefined;

    function onKeyDown(event) {
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

export default function App() {
  const demoMode = isDemoMode();
  const [authenticated, setAuthenticated] = useState(demoMode ? true : null); // null = loading

  useEffect(() => {
    if (demoMode) return undefined;

    // Warm the Dashboard chunk in parallel with the auth round trip so its fetch
    // is no longer serialized behind checkAuth → Suspense mount. Correctness is
    // unchanged: the gate below still renders Dashboard only when authenticated;
    // this only overlaps the (otherwise wasted) waterfall. Swallow rejections so
    // a prefetch failure never surfaces — the real lazy() mount handles errors.
    importDashboard().catch(() => {});

    checkAuth()
      .then((res) => setAuthenticated(res.authenticated))
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
              <Suspense fallback={<AuthSpinner />}>
                <Login onLogin={() => setAuthenticated(true)} />
              </Suspense>
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
              <Suspense fallback={<AuthSpinner />}>
                <SettingsRoute />
              </Suspense>
            ) : <Navigate to="/login" replace />
          } />
        </Routes>
      </BrowserRouter>
    </ChunkLoadBoundary>
  );
}
