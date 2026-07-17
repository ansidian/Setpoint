import { Router } from "express";
import { requireCookieSession } from "../../middleware/auth.ts";
import dev from "./dev.js";
import bills, { quickTxnRouter } from "./bills.ts";
import email from "./email.js";
import emailIndex from "./email-index.js";
import tasks from "./tasks.ts";
import snapshot from "./snapshot.ts";

const router = Router();
router.use(quickTxnRouter);
router.use(requireCookieSession);

router.use(dev);
router.use(email);
router.use(emailIndex);
router.use(tasks);
router.use(bills);
router.use(snapshot);

export default router;
