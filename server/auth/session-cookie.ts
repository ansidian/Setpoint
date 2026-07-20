import type { Response } from "express";
import { createSession, type SessionAuthMethod } from "../middleware/auth.ts";

const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function setSessionCookie(res: Response, token: string) {
  res.cookie("ea_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie("ea_session", { path: "/" });
}

export async function issueSessionCookie(
  res: Response,
  {
    securityGeneration,
    authMethod,
    authenticatedAt = Date.now(),
    passwordAuthenticatedAt,
  }: {
    securityGeneration: number;
    authMethod: SessionAuthMethod;
    authenticatedAt?: number;
    passwordAuthenticatedAt?: number;
  },
): Promise<boolean> {
  const token = await createSession({
    securityGeneration,
    authMethod,
    authenticatedAt,
    passwordAuthenticatedAt,
  });
  if (!token) {
    clearSessionCookie(res);
    return false;
  }
  setSessionCookie(res, token);
  return true;
}
