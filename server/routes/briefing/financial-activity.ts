import { Router } from "express";
import { financialActivityReader } from "../../financial-activity/financial-activity.ts";
import { resolveFinancialActivityBinding } from "../../financial-activity/financial-activity-binding.ts";
import type { FinancialActivityQuery, FinancialActivityReference } from "../../../shared/types/financial-activity.ts";

const router = Router();
const owner = () => process.env.EA_USER_ID!;
function text(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > 1000) throw Object.assign(new Error("Invalid activity query"), { status: 400 });
  return value;
}
router.get("/financial-activity", async (req, res, next) => {
  try {
    const offset = text(req.query.offset);
    if (offset !== undefined && !/^\d+$/.test(offset)) throw Object.assign(new Error("Invalid activity offset"), { status: 400 });
    res.json(await financialActivityReader.list(owner(), {
      view: text(req.query.view) as FinancialActivityQuery["view"],
      source: text(req.query.source) as FinancialActivityQuery["source"],
      context: text(req.query.context) as FinancialActivityQuery["context"], runId: text(req.query.runId),
      offset: offset === undefined ? 0 : Number(offset),
    }));
  } catch (error) { next(error); }
});
router.get("/financial-activity/:owner/:id", async (req, res, next) => {
  try {
    const reference = { owner: req.params.owner, id: req.params.id, runId: text(req.query.runId) } as FinancialActivityReference;
    const detail = await financialActivityReader.detail(owner(), reference);
    if (!detail) return res.status(404).json({ message: "Financial activity not found" });
    res.json(detail);
  } catch (error) { next(error); }
});
router.post("/financial-activity/binding", async (req, res, next) => {
  try { res.json(await resolveFinancialActivityBinding(owner(), req.body?.reference, req.body?.budgetId)); }
  catch (error) { next(error); }
});
export default router;
