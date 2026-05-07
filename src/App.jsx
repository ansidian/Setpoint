import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { checkAuth } from "./api";
import MouseSpotlightCanvas from "./components/layout/MouseSpotlightCanvas";
const Dashboard = lazy(() => import("./pages/Dashboard"));
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
  const [authenticated, setAuthenticated] = useState(null); // null = loading

  useEffect(() => {
    checkAuth()
      .then((res) => setAuthenticated(res.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return <AuthSpinner />;
  }

  return (
    <>
      <MouseSpotlightCanvas />
      <BrowserRouter>
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
              <Suspense fallback={<AuthSpinner />}>
                <Dashboard />
              </Suspense>
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
    </>
  );
}
