import { Router } from 'express';
import { readFinanceWorkspace } from '../../finances/finance-workspace.ts';
import { readJournalRange } from '../../actual/actual.ts';

const router = Router();
const owner = () => process.env.EA_USER_ID!;
router.get('/finances', async (_req, res, next) => {
  try { res.json(await readFinanceWorkspace(owner())); } catch (error) { next(error); }
});
router.get('/finances/journal', async (req, res, next) => {
  try {
    res.json(await readJournalRange(owner(), { start: String(req.query.start || ''), end: String(req.query.end || ''),
      transactionId: typeof req.query.transactionId === 'string' ? req.query.transactionId : undefined }));
  } catch (error) { next(error); }
});
export default router;
