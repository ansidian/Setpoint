import { Router } from "express";
import { requireCookieSessionOrApiTokenScope } from "../../middleware/auth.js";
import * as billsService from "../../briefing/bills-service.js";

const router = Router();
const quickTxnRouter = Router();
const EA_USER_ID = process.env.EA_USER_ID;

function isBlank(value) {
  return value == null || String(value).trim() === "";
}

function validateSendBillPayload(billData) {
  if (!billData || typeof billData !== "object") return "bill data is required";
  if (isBlank(billData.type)) return "type is required";
  if (billData.amount == null || billData.amount === "") return "amount is required";

  const amount = Number(billData.amount);
  if (!Number.isFinite(amount)) return "amount must be a number";
  if (amount <= 0) return "amount must be greater than 0";
  if (isBlank(billData.due_date)) return "due_date is required";

  if (billData.type === "transfer") {
    if (isBlank(billData.from_account_id) || isBlank(billData.to_account_id) || isBlank(billData.schedule_name)) {
      return "from_account_id, to_account_id, and schedule_name are required for transfers";
    }
    return null;
  }

  if (isBlank(billData.payee)) return "payee is required";
  return null;
}

router.post("/actual/send", async (req, res) => {
  const billData = req.body;
  const validationError = validateSendBillPayload(billData);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }
  try {
    res.json(await billsService.sendBill(EA_USER_ID, billData));
  } catch (err) {
    console.error("Error sending to Actual Budget:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

quickTxnRouter.post("/actual/quick-txn", requireCookieSessionOrApiTokenScope("actual:write"), async (req, res) => {
  const { account, amount, payee, type, date, notes, category } = req.body || {};
  if (!account || amount == null || !payee) {
    return res.status(400).json({ message: "account, amount, and payee are required" });
  }
  try {
    const result = await billsService.createQuickTxn(EA_USER_ID, {
      accountName: account,
      amount: Number(amount),
      payee: String(payee),
      type: type === "deposit" ? "deposit" : "payment",
      date,
      notes,
      categoryName: category || null,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("[EA] quick-txn error:", err);
    res.status(status).json({ message: err.message });
  }
});

router.post("/bills/extract", async (req, res) => {
  const { subject, from, body } = req.body || {};
  if (!body || typeof body !== "string") {
    return res.status(400).json({ message: "body is required" });
  }
  try {
    res.json(await billsService.extractBill(EA_USER_ID, { subject, from, body }));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Error extracting bill:", err);
    res.status(status).json({ message: err.message });
  }
});

router.post("/actual/bills/:id/mark-paid", async (req, res) => {
  try {
    res.json(await billsService.markBillPaid(EA_USER_ID, req.params.id));
  } catch (err) {
    console.error("Error marking bill paid:", err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/actual/metadata", async (_req, res) => {
  try {
    res.json(await billsService.getMetadata(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching Actual Budget metadata:", err.message);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/actual/accounts", async (_req, res) => {
  try {
    res.json(await billsService.listAccounts(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching Actual Budget accounts:", err.message);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/actual/payees", async (_req, res) => {
  try {
    res.json(await billsService.listPayees(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching Actual Budget payees:", err.message);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/actual/categories", async (_req, res) => {
  try {
    res.json(await billsService.listCategories(EA_USER_ID));
  } catch (err) {
    console.error("Error fetching Actual Budget categories:", err.message);
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.post("/actual/test", async (req, res) => {
  const { serverURL, password, syncId } = req.body || {};
  const overrides = serverURL && syncId ? { serverURL, password, syncId } : null;
  try {
    res.json(await billsService.testConnection(EA_USER_ID, overrides));
  } catch (err) {
    console.error("Actual Budget test failed:", err.message);
    res.status(err.status || 400).json({ message: err.message || "Connection failed", success: false });
  }
});

export { quickTxnRouter };
export default router;
