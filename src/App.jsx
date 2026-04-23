import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { checkAuth } from "./api";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import SettingsChrome from "./components/settings/SettingsChrome";
const Settings = lazy(() => import("./pages/Settings"));

export default function App() {
  const [authenticated, setAuthenticated] = useState(null); // null = loading

  useEffect(() => {
    checkAuth()
      .then((res) => setAuthenticated(res.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/10 border-t-accent-light rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={
            authenticated ? <Navigate to="/" replace /> : <Login onLogin={() => setAuthenticated(true)} />
          } />
          <Route path="/" element={
            authenticated ? <Dashboard /> : <Navigate to="/login" replace />
          } />
          <Route path="/settings" element={
            authenticated ? (
              <Suspense fallback={<SettingsChrome />}>
                <Settings />
              </Suspense>
            ) : <Navigate to="/login" replace />
          } />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  );
}
