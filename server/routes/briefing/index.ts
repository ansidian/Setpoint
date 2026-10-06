import finances from './finances.ts';
import { Router } from "express";
import { requireCookieSession } from "../../middleware/auth.ts";
import dev from "./dev.ts";
import actualConnection from "./actual-connection.ts";
import email from "./email.ts";
import emailIndex from "./email-index.ts";
import tasks from "./tasks.ts";
import snapshot from "./snapshot.ts";

const router = Router();
router.use(requireCookieSession);

router.use(dev);
router.use(email);
router.use(emailIndex);
router.use(tasks);
router.use(actualConnection);
router.use(snapshot);
router.use(finances);

export default router;
