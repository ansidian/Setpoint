import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import {
  createSession,
  validateSession,
  deleteSession,
  requireCookieSession,
} from "../middleware/auth.js";
import db from "../db/connection.js";

const router = Router();
const EA_PASSWORD_HASH = process.env.EA_PASSWORD_HASH;

const KNOWN_SCOPES = new Set(["actual:write"]);

// Rate limit token minting: 5 creations per 15 minutes per IP
const tokenMintLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many token creations, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit login: 5 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many login attempts, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, async (req, res) => {
  const { password } = req.body;

  if (!EA_PASSWORD_HASH || !password) {
    return res.status(401).json({ message: "Invalid password" });
  }

  const match = await bcrypt.compare(password, EA_PASSWORD_HASH);
  if (!match) {
    return res.status(401).json({ message: "Invalid password" });
  }

  const token = await createSession();
  res.cookie("ea_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ authenticated: true });
});

router.get("/check", async (req, res) => {
  const token = req.cookies?.ea_session;
  res.json({ authenticated: await validateSession(token) });
});

router.post("/logout", async (req, res) => {
  const token = req.cookies?.ea_session;
  if (token) {
    await deleteSession(token);
  }
  res.clearCookie("ea_session", { path: "/" });
  res.json({ authenticated: false });
});

// --- API tokens (for iOS Shortcuts etc.) ---

router.get("/api-tokens", requireCookieSession, async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT id, label, scopes, created_at, last_used_at, expires_at FROM ea_api_tokens ORDER BY created_at DESC",
      args: [],
    });
    const rows = result.rows.map((r) => ({
      id: r.id,
      label: r.label,
      scopes: safeParseScopes(r.scopes),
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      expires_at: r.expires_at,
    }));
    res.json(rows);
  } catch (err) {
    console.error("Error listing api tokens:", err);
    res.status(500).json({ message: "Failed to list tokens" });
  }
});

router.post("/api-tokens", tokenMintLimiter, requireCookieSession, async (req, res) => {
  const { label, scopes } = req.body || {};
  if (!label || typeof label !== "string" || !label.trim()) {
    return res.status(400).json({ message: "label is required" });
  }
  const requestedScopes = Array.isArray(scopes) && scopes.length ? scopes : ["actual:write"];
  const invalid = requestedScopes.filter((s) => !KNOWN_SCOPES.has(s));
  if (invalid.length) {
    return res.status(400).json({ message: `Unknown scopes: ${invalid.join(", ")}` });
  }

  try {
    const raw = "eatk_" + crypto.randomBytes(32).toString("base64url");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    await db.execute({
      sql: "INSERT INTO ea_api_tokens (token_hash, label, scopes, created_at) VALUES (?, ?, ?, ?)",
      args: [hash, label.trim(), JSON.stringify(requestedScopes), Date.now()],
    });
    res.json({ token: raw, label: label.trim(), scopes: requestedScopes });
  } catch (err) {
    console.error("Error creating api token:", err);
    res.status(500).json({ message: "Failed to create token" });
  }
});

router.delete("/api-tokens/:id", requireCookieSession, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: "invalid id" });
  }
  try {
    await db.execute({ sql: "DELETE FROM ea_api_tokens WHERE id = ?", args: [id] });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting api token:", err);
    res.status(500).json({ message: "Failed to delete token" });
  }
});

function safeParseScopes(raw) {
  try { return JSON.parse(raw); } catch { return []; }
}

export default router;
