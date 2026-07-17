import type { RequestHandler } from "express";
import { getActiveOwner } from "../auth/owner-context.ts";

export const requireClaimedInstance: RequestHandler = (req, res, next) => {
  if (req.path === "/auth/setup/status" || req.path === "/auth/setup/claim") {
    return next();
  }
  if (!getActiveOwner()) {
    return res.status(503).json({ message: "Instance setup required" });
  }
  return next();
};
