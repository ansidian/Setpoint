import crypto from "crypto";
import { Router } from "express";
import type { CookieOptions, Response } from "express";
import { hashToken, requireCookieSession } from "../middleware/auth.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";
import {
  todoistOAuthService,
  type TodoistOAuthService,
} from "../tasks/todoist-setup.ts";

const BIND_COOKIE = "ea_todoist_oauth_bind";
const CALLBACK_PATH = "/api/ea/accounts/todoist/callback";

function bindCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: CALLBACK_PATH,
  };
}

function clearBindCookie(res: Response): void {
  res.clearCookie(BIND_COOKIE, { path: CALLBACK_PATH });
}

export function createTodoistOAuthRouter(
  service: TodoistOAuthService = todoistOAuthService,
  randomBind = () => crypto.randomBytes(32).toString("base64url"),
) {
  const router = Router();
  wrapRouterAsync(router);

  router.get("/accounts/todoist/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const oauthError = typeof req.query.error === "string" ? req.query.error : null;
    const browserBind = req.cookies?.[BIND_COOKIE];
    clearBindCookie(res);
    if (oauthError || !code || !state || !browserBind) {
      return res.status(400).send("Todoist OAuth failed. Please try connecting again.");
    }
    try {
      await service.completeAuthorization({
        code,
        state,
        browserBindHash: hashToken(browserBind),
      });
      const baseUrl = process.env.NODE_ENV === "production" ? "" : "http://localhost:5173";
      return res.redirect(`${baseUrl}/settings?todoist_connected=1`);
    } catch {
      console.warn("[Todoist OAuth] Callback could not be completed");
      return res.status(400).send("Todoist OAuth failed. Please try connecting again.");
    }
  });

  router.get("/accounts/todoist/auth", requireCookieSession, async (_req, res) => {
    const browserBind = randomBind();
    const result = await service.beginAuthorization(process.env.EA_USER_ID!, hashToken(browserBind));
    res.cookie(BIND_COOKIE, browserBind, bindCookieOptions());
    return res.json(result);
  });

  router.get("/accounts/todoist/status", requireCookieSession, async (_req, res) => {
    return res.json(await service.getStatus(process.env.EA_USER_ID!));
  });

  return router;
}

export default createTodoistOAuthRouter();
