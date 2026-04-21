import "dotenv/config";

process.on("unhandledRejection", (err) => {
  console.error("[Unhandled Rejection]", err?.message || err);
});

import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import authRoutes from "./routes/auth.js";
import briefingRoutes from "./routes/briefing/index.js";
import accountsRoutes from "./routes/accounts.js";
import searchRoutes from "./routes/search.js";
import liveRoutes from "./routes/live.js";
import calendarRoutes from "./routes/calendar.js";
import notesRoutes from "./routes/notes.js";
import { initScheduler, startBackgroundIndexer } from "./briefing/scheduler.js";
import { startSnoozeWaker } from "./briefing/snooze-waker.js";
import { migrate } from "./db/migrate.js";
import { migrateLegacyEncryption } from "./db/migrate-encryption.js";


// fail fast if critical env vars are missing
const REQUIRED_ENV = ["EA_USER_ID", "EA_PASSWORD_HASH", "EA_ENCRYPTION_KEY"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[EA] Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Trust first proxy (Render, Vite dev proxy) so req.ip reflects the real client
app.set("trust proxy", 1);

app.use(express.json());
app.use(cookieParser());

// CSRF protection: require custom header on all state-changing API requests.
// Bearer-authenticated requests are exempt — CSRF only applies to cookie auth,
// and a forged request can't attach a bearer token the attacker doesn't have.
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  if (req.path === "/auth/login") return next();
  if (req.headers.authorization?.startsWith("Bearer ")) return next();
  if (req.headers["x-requested-with"] !== "EADashboard") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/briefing", briefingRoutes);
app.use("/api/ea", accountsRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/live", liveRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/notes", notesRoutes);

// Serve static frontend in production (behind auth)
if (process.env.NODE_ENV === "production") {
  // Static assets are public — they're just the built frontend bundle
  app.use(express.static(join(__dirname, "../dist")));

  // SPA fallback — serve index.html for all non-API routes
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ message: "Not found" });
    }
    res.sendFile(join(__dirname, "../dist/index.html"));
  });
}

migrate().then(() => migrateLegacyEncryption()).then(() => {
  app.listen(PORT, () => {
    console.log(`EA Dashboard running on http://localhost:${PORT}`);
    initScheduler().catch((err) =>
      console.error("[EA Scheduler] Init failed:", err.message),
    );
    startBackgroundIndexer();
    startSnoozeWaker();
  });
}).catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
