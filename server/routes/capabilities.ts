import { Router, type RequestHandler } from "express";
import { requireCookieSession } from "../middleware/auth.ts";
import {
  capabilityStatusService,
  type CapabilityStatusService,
} from "../capability-status-service.ts";
import { wrapRouterAsync } from "../middleware/async-handler.ts";

export function createCapabilitiesRouter(
  service: Pick<CapabilityStatusService, "getStatus"> = capabilityStatusService,
  authenticate: RequestHandler = requireCookieSession,
) {
  const router = Router();
  wrapRouterAsync(router);
  router.get("/", authenticate, async (req, res) => {
    return res.json(await service.getStatus({ refresh: req.query.refresh === "1" }));
  });
  return router;
}

export default createCapabilitiesRouter();
