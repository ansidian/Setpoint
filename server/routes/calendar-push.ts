import { Router } from "express";
import { receiveCalendarPushNotification } from "../calendar/calendar-push.ts";

const router = Router();

// Mounted before cookie/CSRF middleware. A persisted channel token and resource
// identity authorize this bodyless provider callback; owner sessions do not.
router.post("/", async (req, res) => {
  try {
    const result = await receiveCalendarPushNotification(req.headers);
    if (!result.accepted) return res.sendStatus(401);
    return res.sendStatus(204);
  } catch {
    // Never acknowledge a notification whose durable enqueue failed.
    return res.sendStatus(503);
  }
});

export default router;
