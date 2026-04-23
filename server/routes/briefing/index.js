import { Router } from "express";
import { requireCookieSession } from "../../middleware/auth.js";
import dev from "./dev.js";
import bills, { quickTxnRouter } from "./bills.js";
import email from "./email.js";
import tasks from "./tasks.js";
import lifecycle from "./lifecycle.js";

const router = Router();
router.use(quickTxnRouter);
router.use(requireCookieSession);

// More-specific sub-routers first; lifecycle mounts LAST because /:id is a greedy one-segment catch-all.
router.use(dev);
router.use(email);
router.use(tasks);
router.use(bills);
router.use(lifecycle);

export default router;
